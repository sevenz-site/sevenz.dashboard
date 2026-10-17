-- 119: THE OWNER'S WHATSAPP READS THE SAME DEADLINE THE SCREEN READS
--
-- Found on 2026-10-16 by the owner's own question -- *«¿el agregar cuotas
-- afectará el envío de la notificación en whatsapp?»* -- and the answer turned
-- out to be yes, in a way nothing would have announced.
--
-- ===========================================================================
-- WHAT WAS ABOUT TO SHIP
--
-- Migration `118` taught the ledger that a fiado can be agreed in cuotas, and
-- the screen now judges a client against the NEXT UNPAID CUOTA:
-- `client_summary.oldest_unpaid_charge_due_at`.
--
-- Two functions that send WhatsApp to the OWNER never got the message. Both
-- work the deadline out for themselves, from the whole term:
--
--   whatsapp_destinatarios_resumen()  -> overdue_clients
--   whatsapp_destinatarios_atencion() -> vencido, vence_pronto
--
--       cs.oldest_unpaid_charge_at + (cs.oldest_unpaid_charge_plazo_dias
--                                     || ' days')::interval < now()
--
-- With cuotas those two sentences stop agreeing. A client who owes 90 in 3
-- cuotas over 30 days and has missed the first one reads "Plazo vencido" on
-- the shopkeeper's screen, and would NOT be counted among the
-- `overdue_clients` of his own weekly WhatsApp -- because the 30 days have not
-- passed. The same client, two answers, in the same product, on the same day.
--
-- IT IS NOT A DEFECT OF TODAY. Nobody can create a fiado with cuotas until
-- `118` and its screens reach production, so right now both sentences give the
-- same result for every row in the database. That is also why this is safe:
-- for a charge with no cuotas `due_at` IS `charge_at + plazo_dias`, exactly,
-- so this migration changes NOTHING about what anybody receives today. It only
-- stops the two from parting company the day cuotas ship.
--
-- ===========================================================================
-- AND IT KEEPS THE RULE THE 068 WROTE, which is worth saying because it looks
-- like it breaks it
--
-- Those functions carry a deliberate note: *«desde los datos crudos, nunca
-- desde el estado que pinta la insignia»* -- do not count clients by reading
-- `getClientStatus`, count them from the data. That rule stands and this
-- respects it: `oldest_unpaid_charge_due_at` is a column of the view, computed
-- in SQL by the FIFO queue. It is not the badge; it is the date the badge is
-- made of. What changes is that the arithmetic lives in ONE place instead of
-- three.

begin;

-- LAS DOS FUNCIONES VAN COPIADAS VERBATIM DE LA `072`, y lo único que cambia
-- es la aritmética de la fecha. No es pereza: al escribirlas de memoria la
-- primera vez salieron con seis diferencias —un `left join` convertido en
-- `join`, los `coalesce` perdidos, un `having` inventado, una columna de más y
-- la regla de consentimiento escrita al revés— y cualquiera de ellas habría
-- cambiado en silencio a quién se le escribe cada semana. Se extrajeron del
-- archivo y se parchearon las dos líneas que tocaba.

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
          and cs.oldest_unpaid_charge_due_at is not null
          and cs.oldest_unpaid_charge_due_at < now()
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
      -- La fecha la calcula la cola FIFO una sola vez, en la vista. Antes se
      -- rehacía aquí con `carga_at + plazo`, que es lo mismo mientras no haya
      -- cuotas y deja de serlo en cuanto las haya (migración `118`).
      cs.oldest_unpaid_charge_due_at as vence_at,
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
      (c.debe and c.vence_at is not null and c.vence_at < now()) as vencido,
      (
        c.debe and c.vence_at is not null
        and c.vence_at >= now()
        and c.vence_at < now() + interval '7 days'
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
-- dejarlas abiertas sería una fuga de datos, no una molestia. La `072` ya lo
-- dejó escrito y aquí se repite por el mismo motivo — el reemplazo lo deshace.
revoke execute on function public.whatsapp_destinatarios_resumen() from public, anon, authenticated;
revoke execute on function public.whatsapp_destinatarios_atencion() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_resumen() to service_role;
grant execute on function public.whatsapp_destinatarios_atencion() to service_role;

insert into public.schema_migrations (key, description)
values (
  '119_whatsapp_mira_el_vencimiento',
  'whatsapp_destinatarios_resumen() y _atencion() dejan de rehacer la cuenta del vencimiento y leen client_summary.oldest_unpaid_charge_due_at, la misma columna que mira la pantalla desde la 118. Salio de una pregunta del dueno el 2026-10-16 sobre si las cuotas afectaban a WhatsApp: si, y de forma invisible. Las dos calculaban carga_at + plazo_dias, o sea el plazo ENTERO, asi que un cliente con una cuota vencida saldria «Plazo vencido» en la pantalla del tendero y NO contaria entre los overdue_clients de su propio resumen semanal. Hoy no es un defecto --sin cuotas due_at ES carga_at + plazo, identico-- y por eso esto no cambia nada de lo que nadie recibe: evita que las dos frases se separen el dia que las cuotas lleguen a produccion. Respeta la nota de la 068 («desde los datos crudos, nunca desde el estado que pinta la insignia»): due_at es una columna de la vista calculada en SQL, es la fecha con la que la insignia esta hecha y no la insignia. Los cuerpos se copiaron VERBATIM de la 072 y lo unico que cambia es la aritmetica de la fecha. No cambia ningun texto ni ninguna variable de plantilla: NO hace falta volver a pasar por Meta.'
)
on conflict (key) do nothing;

commit;
