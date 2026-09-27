-- 069_whatsapp_destinatarios_atencion.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- Las tres cifras de `cartera_attention`, la plantilla de los jueves. Una fila
-- por dueño que aceptó los avisos.
--
-- SECURITY DEFINER y granted solo a service_role, por lo mismo que la 067 y la
-- 068: el cron corre con la clave de servicio y producción le revoca SELECT
-- sobre las tablas de clientes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS TRES CIFRAS, Y LO QUE CADA UNA ESCONDE
--
-- Están escritas en ../docs/WHATSAPP-PLANTILLAS.md. Se repiten aquí porque
-- éste es el sitio donde se pueden escribir mal sin que nadie lo note: el
-- mensaje diría un número plausible sobre la cartera equivocada.
--
--   Clientes con plazo vencido: {{overdue_clients}}
--   Clientes que vencen en los próximos 7 días: {{due_this_week}}
--   Clientes que vieron su saldo esta semana y no abonaron: {{viewed_no_payment}}
--
-- 1. `overdue_clients` — la misma trampa que en la 068. NO se cuenta pasando
--    por `getClientStatus()`, que devuelve `critico` antes que `plazo_vencido`
--    a los 30 días sin abono y dejaría fuera justo a los peores deudores.
--    Medido contra dev el 2026-09-23: 17 en vez de 18 en una cartera real.
--
-- 2. `due_this_week` — los que AÚN no han vencido y vencen dentro de siete
--    días. Excluyente con el anterior por construcción: un plazo está vencido
--    o no lo está. Son siete días contados desde el envío, no "lo que queda de
--    semana" — y por eso la etiqueta de la plantilla dice "en los próximos 7
--    días" en vez de "esta semana", que el jueves admite dos lecturas.
--
-- 3. `viewed_no_payment` — tres condiciones, y solo la primera está en la
--    etiqueta:
--      a) hay una apertura del enlace en los últimos 7 días;
--      b) NO hay ningún abono posterior a esa apertura — sin esto "no
--         abonaron" no significa nada, y un cliente que abrió en marzo y pagó
--         en abril seguiría contando;
--      c) tiene deuda. Quien no debe nada y miró su saldo no es un pendiente.
--    Sin la ventana de 7 días esta cifra SOLO SUBE, para siempre, y a los tres
--    meses el dueño deja de leer el mensaje entero.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS TRES SE SOLAPAN, Y ES A PROPÓSITO
--
-- Un cliente con el plazo vencido que además vio su saldo y no abonó cuenta en
-- la primera y en la tercera. Las dos primeras sí son excluyentes entre sí; la
-- tercera es otro eje — no es *cuándo* vence, es *qué hizo el cliente*.
-- Separarlas del todo alargaría el mensaje y lo haría menos útil. Queda escrito
-- para que el día que alguien reporte "los números no suman" se sepa que es el
-- diseño.
--
-- La supresión de vacíos (no mandar nada cuando las tres son cero) NO está
-- aquí: vive en lib/whatsapp/cartera-attention.ts, junto al comentario que
-- explica por qué. Esta función solo cuenta.

begin;

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
    group by o.id, o.whatsapp, o.first_name
  ) d;
$$;

-- Revocar a `public` no basta: Supabase concede EXECUTE a anon y authenticated
-- sobre toda función nueva del esquema public, y eso es un grant explícito.
-- Esta función devuelve los teléfonos de todos los dueños.
revoke execute on function public.whatsapp_destinatarios_atencion() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_atencion() to service_role;

insert into public.schema_migrations (key, description)
values (
  '069_whatsapp_destinatarios_atencion',
  'whatsapp_destinatarios_atencion(): las tres cifras de cartera_attention, la plantilla de los jueves. SECURITY DEFINER granted solo a service_role. overdue_clients con la misma trampa evitada que la 068 — no se pasa por getClientStatus, que devuelve critico antes que plazo_vencido y dejaria fuera a los peores deudores (medido: 17 en vez de 18 en una cartera real). due_this_week son los que aun no vencen y vencen dentro de SIETE DIAS contados desde el envio, no "lo que queda de semana", que un jueves admite dos lecturas. viewed_no_payment lleva tres condiciones y solo la primera esta en la etiqueta: apertura del enlace en los ultimos 7 dias, sin ningun abono POSTERIOR a esa apertura, y que el cliente tenga deuda; sin la ventana la cifra solo sube y a los tres meses el mensaje deja de leerse. La supresion de vacios no esta aqui, vive en el codigo junto a su explicacion.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Nadie con sesión puede sacar los teléfonos de todos los dueños:
--
--   select has_function_privilege('anon', 'public.whatsapp_destinatarios_atencion()', 'execute'),
--          has_function_privilege('authenticated', 'public.whatsapp_destinatarios_atencion()', 'execute');
--   -- EXPECTED: false, false.
--
-- 2. `overdue_clients` tiene que dar lo mismo que la 068 para el mismo dueño,
--    porque es la misma definición escrita dos veces. Si divergen, una de las
--    dos está mal:
--
--   select (r->>'owner_id') as dueno, (r->>'overdue_clients') as resumen
--   from public.whatsapp_destinatarios_resumen() r;
--
--   select (a->>'owner_id') as dueno, (a->>'overdue_clients') as atencion
--   from public.whatsapp_destinatarios_atencion() a;
--
-- 3. Y vencido / vence_pronto no pueden solaparse: ningún cliente puede estar
--    en los dos, porque un plazo está vencido o no lo está.
