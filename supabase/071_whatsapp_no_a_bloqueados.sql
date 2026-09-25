-- 071_whatsapp_no_a_bloqueados.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh) first. En
-- produccion (rabmiyqodnvnrwiartuj) va DESPUES de la 068 y la 069, porque
-- redefine las dos funciones que aquellas crean.
--
-- A una cuenta bloqueada no se le escribe.
--
-- --------------------------------------------------------------------------
-- EL AGUJERO
--
-- Las funciones de la 068 y la 069 eligen destinatarios comprobando tres
-- cosas: que haya numero, que haya consentimiento, y que no se haya dado de
-- baja despues. Ninguna mira si la cuenta esta bloqueada.
--
-- Asi que un dueno bloqueado con los avisos encendidos recibia el lunes
-- "Por cobrar: $350.50 - Clientes con plazo vencido: 18". Tres problemas a la
-- vez, y el tercero es el que de verdad duele:
--
--   1. Le invita a actuar en una app que no le deja actuar: desde la 061,
--      fiar, abonar, crear clientes e importar estan bloqueados.
--   2. Se paga a Meta por cada mensaje, y una cuenta bloqueada suele estarlo
--      por no pagar. Se gasta justo en quien no paga.
--   3. Es la clase de mensaje que alguien marca como no deseado. Con un solo
--      numero para toda la plataforma, eso baja el quality rating de TODOS
--      los duenos a la vez.
--
-- --------------------------------------------------------------------------
-- COMO SE ESCRIBIO ESTE ARCHIVO, QUE IMPORTA
--
-- Los dos cuerpos de abajo son COPIA LITERAL de los de la 068 y la 069, con
-- UNA linea anadida en cada uno. No se reescribieron a mano: el primer
-- intento si lo hizo y cambio `returns setof jsonb` por `returns table(...)`,
-- que `create or replace` habria rechazado —no se puede cambiar el tipo de
-- retorno— ademas de renombrar alias del CTE por el camino. Copiar y anadir
-- una linea no tiene esa clase de fallo.
--
-- --------------------------------------------------------------------------
-- POR QUE SE REUSA `owner_puede_escribir` Y NO SE COPIA LA CONDICION
--
-- Podria ponerse `estado <> bloqueada` aqui, pero entonces habria dos
-- definiciones de "bloqueado" y el dia que cambie una, la otra se queda atras
-- en silencio. La funcion de la 061 ya lo resuelve, incluido el
-- `coalesce(..., true)` que deja pasar a quien no tiene fila de suscripcion
-- —los registrados antes de la 057— y que replicado a mano se olvidaria.
--
-- OJO CON EL SENTIDO: `owner_puede_escribir` quiere decir "puede registrar
-- movimientos", y se usa aqui como sinonimo de "su cuenta esta al dia", que
-- es lo que hoy significa. Si algun dia hubiera un estado en el que se puede
-- escribir pero no se le debe escribir por WhatsApp —o al reves— esto deja de
-- valer y hace falta una condicion propia.

begin;

-- ---- El resumen semanal (cuerpo de la 068 + una linea) -------------------
create or replace function public.whatsapp_destinatarios_resumen()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(d)
  from (
    select
      o.id as owner_id,
      o.whatsapp,
      o.first_name,
      o.country,
      -- Cada moneda por su lado: sumarlas sería inventar un número. Solo los
      -- saldos deudores, igual que "Capital por cobrar".
      coalesce(sum(cs.balance)     filter (where cs.balance > 0), 0)     as balance_cop,
      coalesce(sum(cs.balance_usd) filter (where cs.balance_usd > 0), 0) as balance_usd,
      coalesce(sum(cs.balance_eur) filter (where cs.balance_eur > 0), 0) as balance_eur,
      -- Ver la nota larga de arriba: desde los datos crudos, nunca desde el
      -- estado que pinta la insignia.
      count(*) filter (
        where (cs.balance > 0 or cs.balance_usd > 0 or cs.balance_eur > 0)
          and cs.oldest_unpaid_charge_at is not null
          and cs.oldest_unpaid_charge_plazo_dias is not null
          and cs.oldest_unpaid_charge_at
              + (cs.oldest_unpaid_charge_plazo_dias || ' days')::interval < now()
      ) as overdue_clients
    from public.owners o
    -- Aceptó y no se dio de baja después. Misma regla que
    -- `aceptaAvisosWhatsapp()` en lib/whatsapp-opt-in.ts, y escrita dos veces
    -- a propósito: la de TypeScript decide qué enseña la pantalla, ésta decide
    -- a quién se le escribe de verdad. Si alguna vez divergen, la que manda es
    -- ésta.
    left join public.client_summary cs on cs.owner_id = o.id
    where o.whatsapp is not null
      and o.whatsapp <> ''
      and o.whatsapp_opt_in_at is not null
      and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
      -- LO UNICO QUE ANADE LA 071: a una cuenta bloqueada no se le escribe.
      and public.owner_puede_escribir(o.id)
    group by o.id, o.whatsapp, o.first_name, o.country
  ) d;
$$;

revoke execute on function public.whatsapp_destinatarios_resumen() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_resumen() to service_role;

-- ---- Lo que necesita atencion (cuerpo de la 069 + una linea) -------------
create or replace function public.whatsapp_destinatarios_atencion()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  with clientes as (
    select
      cs.owner_id,
      cs.client_id,
      (cs.balance > 0 or cs.balance_usd > 0 or cs.balance_eur > 0) as debe,
      cs.oldest_unpaid_charge_at as carga_at,
      cs.oldest_unpaid_charge_plazo_dias as plazo,
      (
        select max(lo.opened_at)
        from public.link_opens lo
        where lo.client_id = cs.client_id
          and lo.opened_at >= now() - interval '7 days'
      ) as ultima_apertura
    from public.client_summary cs
  ),
  marcado as (
    select
      c.owner_id,
      (
        c.debe and c.carga_at is not null and c.plazo is not null
        and c.carga_at + (c.plazo || ' days')::interval < now()
      ) as vencido,
      (
        c.debe and c.carga_at is not null and c.plazo is not null
        and c.carga_at + (c.plazo || ' days')::interval >= now()
        and c.carga_at + (c.plazo || ' days')::interval < now() + interval '7 days'
      ) as vence_pronto,
      (
        c.debe and c.ultima_apertura is not null
        and not exists (
          select 1
          from public.movements m
          where m.client_id = c.client_id
            and m.type = 'payment'
            and m.deleted_at is null
            and m.created_at > c.ultima_apertura
        )
      ) as vio_y_no_abono
    from clientes c
  )
  select to_jsonb(d)
  from (
    select
      o.id as owner_id,
      o.whatsapp,
      o.first_name,
      coalesce(count(*) filter (where m.vencido), 0)         as overdue_clients,
      coalesce(count(*) filter (where m.vence_pronto), 0)    as due_this_week,
      coalesce(count(*) filter (where m.vio_y_no_abono), 0)  as viewed_no_payment
    from public.owners o
    left join marcado m on m.owner_id = o.id
    -- Misma regla de consentimiento que la 068 y que aceptaAvisosWhatsapp().
    where o.whatsapp is not null
      and o.whatsapp <> ''
      and o.whatsapp_opt_in_at is not null
      and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
      -- LO UNICO QUE ANADE LA 071: a una cuenta bloqueada no se le escribe.
      and public.owner_puede_escribir(o.id)
    group by o.id, o.whatsapp, o.first_name
  ) d;
$$;

revoke execute on function public.whatsapp_destinatarios_atencion() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_atencion() to service_role;

insert into public.schema_migrations (key, description)
values (
  '071_whatsapp_no_a_bloqueados',
  'whatsapp_destinatarios_resumen() y whatsapp_destinatarios_atencion() dejan fuera a los duenos con la cuenta bloqueada. Antes comprobaban numero y consentimiento pero no el bloqueo, asi que una cuenta bloqueada recibia el lunes un resumen que le invita a actuar en una app que desde la 061 no le deja fiar ni abonar, se pagaba a Meta por enviarlo a quien suele estar bloqueado por no pagar, y era justo la clase de mensaje que alguien marca como no deseado — con un solo numero para toda la plataforma eso baja el quality rating de todos a la vez. Los dos cuerpos son copia literal de la 068 y la 069 con una linea anadida; se reusa owner_puede_escribir en vez de copiar la condicion, para que no haya dos definiciones de bloqueado que puedan separarse.'
)
on conflict (key) do nothing;

commit;

-- ---- verificacion, despues de correr lo de arriba ------------------------
--
-- Cuantos destinatarios quedan. Si algun dueno con avisos esta bloqueado,
-- este numero baja respecto al de antes de correr la migracion:
--
--   select count(*) from public.whatsapp_destinatarios_resumen();
--
-- Y quienes quedaron fuera, si es que hay alguno:
--
--   select o.id, o.business_name, s.estado
--   from public.owners o
--   join public.subscriptions s on s.owner_id = o.id
--   where s.estado = 'bloqueada' and o.whatsapp_opt_in_at is not null;
