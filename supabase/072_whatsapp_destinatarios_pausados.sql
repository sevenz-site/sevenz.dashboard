-- QUIÉN ESTÁ PAUSADO, PARA PODER ESCRIBIRLE OTRA COSA
--
-- Meta aprobó `cartera_pausada` el 2026-09-28. Esta migración es lo que hacía
-- falta para poder usarla.
--
-- COMO COLUMNA, NO COMO FILTRO. La diferencia es todo el cambio:
--
--   filtrando  -> el dueño pausado desaparece de la lista y no recibe nada
--   en columna -> sigue en la lista y recibe OTRA plantilla
--
-- Y lo segundo es la decisión que se tomó el 2026-09-25: a una cuenta pausada
-- SÍ se le escribe. Sigue pudiendo LEER su cartera, así que el resumen del
-- lunes le sirve igual, y recibir el valor del producto es justo lo que puede
-- empujarle a ponerse al día. Cortarle el aviso le quita una razón para volver.
--
-- Lo que NO puede pasar es mandarle el mensaje de un dueño al día, porque le
-- invita a actuar en una app que no le deja: `cartera_summary` termina
-- diciéndole que entre a registrar movimientos. De ahí `cartera_pausada`.
--
-- POR QUÉ BASTA `create or replace`: las dos funciones devuelven `setof jsonb`,
-- no un `returns table(...)`. Añadir una clave al objeto no cambia la firma, así
-- que no hace falta el drop + create con sus dos firmas que exige CLAUDE.md
-- cuando una signatura cambia de verdad. Que devolvieran jsonb fue una buena
-- decisión de la 068 y aquí se cobra sola.

begin;

-- ── 1. El resumen: añade `pausado` ──────────────────────────────────────
--
-- `owner_puede_escribir()` ya existe (061) y es la ÚNICA definición de qué
-- significa estar bloqueado. Se niega aquí en vez de volver a consultar
-- `subscriptions`: dos definiciones de lo mismo terminan discrepando, y esta
-- decide a quién se le manda qué.
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
      -- Ver la nota larga de la 068: desde los datos crudos, nunca desde el
      -- estado que pinta la insignia.
      count(*) filter (
        where (cs.balance > 0 or cs.balance_usd > 0 or cs.balance_eur > 0)
          and cs.oldest_unpaid_charge_at is not null
          and cs.oldest_unpaid_charge_plazo_dias is not null
          and cs.oldest_unpaid_charge_at
              + (cs.oldest_unpaid_charge_plazo_dias || ' days')::interval < now()
      ) as overdue_clients,
      -- LA CLAVE NUEVA. `owner_puede_escribir` es STABLE, así que Postgres la
      -- evalúa una vez por dueño y no una por fila de client_summary.
      not public.owner_puede_escribir(o.id) as pausado
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
    group by o.id, o.whatsapp, o.first_name, o.country
  ) d;
$$;

-- ── 2. Atención: añade `pausado` por el mismo motivo ────────────────────
--
-- Aquí `pausado` NO sirve para elegir plantilla sino para SALTARSE al dueño:
-- el pausado ya recibió `cartera_pausada` en la tanda del resumen, y esa
-- plantilla sustituye a las dos. Mandarle además la de atención sería el
-- segundo mensaje de la semana a quien no puede tocar su cartera — el doble de
-- coste en Meta justo en quien no paga, y el doble de probabilidad de que lo
-- marque como no deseado.
--
-- Se devuelve como columna y el filtro vive en TypeScript, no aquí, para que
-- `/admin` o una consulta de diagnóstico puedan ver a quién se saltó y por qué.
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
      coalesce(count(*) filter (where m.vio_y_no_abono), 0)  as viewed_no_payment,
      not public.owner_puede_escribir(o.id) as pausado
    from public.owners o
    left join marcado m on m.owner_id = o.id
    -- Misma regla de consentimiento que la 068 y que aceptaAvisosWhatsapp().
    where o.whatsapp is not null
      and o.whatsapp <> ''
      and o.whatsapp_opt_in_at is not null
      and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
    group by o.id, o.whatsapp, o.first_name
  ) d;
$$;

-- Revocar a `public` no basta: Supabase concede EXECUTE a anon y authenticated
-- sobre toda función nueva del esquema public, y `create or replace` vuelve a
-- concederlo. Estas funciones devuelven los teléfonos de TODOS los dueños:
-- dejarlas abiertas sería una fuga de datos, no una molestia. Se repite aquí
-- aunque la 068 y la 069 ya lo hicieran, porque el reemplazo lo deshace.
revoke execute on function public.whatsapp_destinatarios_resumen() from public, anon, authenticated;
revoke execute on function public.whatsapp_destinatarios_atencion() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_resumen() to service_role;
grant execute on function public.whatsapp_destinatarios_atencion() to service_role;

insert into public.schema_migrations (key, description)
values (
  '072_whatsapp_destinatarios_pausados',
  'whatsapp_destinatarios_resumen() y _atencion() devuelven `pausado`, negando owner_puede_escribir(). COMO COLUMNA Y NO COMO FILTRO, que es todo el cambio: filtrando, el dueno pausado desaparece y no recibe nada; en columna sigue en la lista y recibe OTRA plantilla, que es la decision del 2026-09-25 (a una cuenta pausada SI se le escribe: sigue pudiendo leer su cartera y recibir el valor del producto puede empujarle a ponerse al dia). En el resumen elige entre cartera_summary y cartera_pausada; en atencion sirve para SALTARSE al pausado, porque cartera_pausada sustituye a las dos y mandarle ademas la de atencion seria el segundo mensaje de la semana a quien no puede tocar su cartera. Basta create or replace porque las dos devuelven setof jsonb y anadir una clave no cambia la firma. Se repiten los revoke: un reemplazo vuelve a conceder EXECUTE a anon y authenticated.'
)
on conflict (key) do nothing;

commit;
