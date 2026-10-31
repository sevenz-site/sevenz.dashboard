-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light. Re-runnable: `create or replace` with the same
-- signature, and the grants are set again either way.
--
-- ===========================================================================
-- 168: THE CLIENT'S DUE-DATE REMINDER COUNTS DAYS IN THE BUSINESS'S ZONE
--
-- `whatsapp_destinatarios_plazo()` turned each cuota's due instant into a DAY
-- with `at time zone 'America/Bogota'`, and took «today» in Bogota too -- for
-- every business. Since `PL-1` (2026-10-30) the screens draw dates in the
-- zone of the business, Caracas for Venezuela, so the two disagreed for any
-- cuota falling due between 00:00 and 00:59 Caracas time: in Bogota that is
-- still the previous day. The WhatsApp went out a day early and named that
-- earlier date, while the owner's screen and the client's link said the real
-- one.
--
-- MEASURED IN DEV ON 2026-10-31 before touching anything: a Venezuelan fiado
-- due at 00:30 Caracas on 2 November was sent on 31 October with
-- «vence el 1 de noviembre»; the control due at noon the same day was not.
-- Asked by the owner the same day: «revisa si los vencimientos de la base
-- usan UTC». Nothing else in the database counts days: the status chips and
-- the owner's weekly summary compare instants (`due < now()`), which no zone
-- can move.
--
-- WHAT CHANGES: two expressions. `cargos` now carries the zone of its
-- business (the same rule as `zonaDelNegocio` in lib/format.ts) and uses it
-- both for the due day and for «today». A Colombian business is untouched --
-- its zone was already Bogota. Everything else is `120` verbatim.
--
-- «TODAY» PER ROW AND NOT ONE FOR ALL: the cron runs at 13:00 UTC, when
-- Caracas and Bogota share the same date, so a single Bogota «today» would
-- happen to work. It is per row anyway because the day of the due date and
-- the day it is compared against have to come from the same clock -- that
-- they did not is the whole bug.

begin;

create or replace function public.whatsapp_destinatarios_plazo()
returns table (
  movement_id uuid,
  client_id uuid,
  owner_id uuid,
  client_name text,
  phone text,
  business_display text,
  due_date date,
  amount_due numeric,
  currency text
)
language sql
stable
security definer
set search_path = public
as $fn$
  with cargos as (
    select
      mv.id,
      mv.client_id,
      mv.currency,
      -- THE BUSINESS'S TODAY, in its own zone. See the header.
      (now() at time zone z.tz)::date as hoy,
      -- Misma expresión que la `118` y que lib/cuotas.ts. Sin cuotas,
      -- coalesce deja n = 1 y k = 1, o sea el plazo entero: idéntico a la 101.
      (
        (mv.created_at
          + (interval '1 day'
             * (mv.plazo_dias::numeric * k / coalesce(mv.cuotas, 1))))
        at time zone z.tz
      )::date as vence,
      -- La ventana del dueno, 2026-10-14, aplicada al tramo que el cliente
      -- tiene delante -- que con cuotas es la cuota y no el plazo entero. La
      -- tabla de los seis casos esta en WHATSAPP-PLANTILLAS.md.
      greatest(
        1,
        least(
          7,
          round((mv.plazo_dias::numeric / coalesce(mv.cuotas, 1)) * 0.25)::int
        )
      ) as dias_antes
    from public.movements mv
    join public.clients mc on mc.id = mv.client_id
    join public.owners mo on mo.id = mc.owner_id
    -- Same rule as `zonaDelNegocio` in lib/format.ts: Venezuela is Caracas,
    -- everything else is Bogota.
    cross join lateral (
      select case when mo.country = 'VE' then 'America/Caracas' else 'America/Bogota' end as tz
    ) z
    cross join lateral generate_series(1, coalesce(mv.cuotas, 1)) as k
    where mv.type = 'charge'
      and mv.deleted_at is null
      and mv.plazo_dias is not null
      and mv.plazo_dias > 0
  ),
  -- El vencimiento mas cercano de cada cliente, de los que aun no han llegado.
  proximo as (
    select distinct on (c.client_id) c.*
    from cargos c
    where c.vence >= c.hoy
    order by c.client_id, c.vence asc, c.id asc
  )
  select
    p.id as movement_id,
    cl.client_id,
    cl.owner_id,
    cl.name as client_name,
    public.normalize_whatsapp_phone(cl.whatsapp) as phone,
    case
      when coalesce(btrim(o.first_name), '') = '' then o.business_name
      else btrim(o.first_name) || ' (' || o.business_name || ')'
    end as business_display,
    p.vence as due_date,
    case p.currency
      when 'USD' then cl.balance_usd
      when 'EUR' then cl.balance_eur
      else cl.balance
    end as amount_due,
    p.currency
  from proximo p
  join public.client_summary_all cl on cl.client_id = p.client_id
  join public.owners o on o.id = cl.owner_id
  where cl.trashed_at is null
    and cl.deleted_at is null
    -- Hoy es el dia: ni antes ni despues.
    and (p.vence - p.dias_antes) = p.hoy
    -- Sin deuda en ESE libro no hay nada que recordar.
    and (case p.currency
           when 'USD' then cl.balance_usd
           when 'EUR' then cl.balance_eur
           else cl.balance
         end) > 0
    and public.normalize_whatsapp_phone(cl.whatsapp) is not null
    and public.client_accepts_whatsapp(cl.client_id);
$fn$;

-- Supabase grants EXECUTE on every new function in public to anon and
-- authenticated, and this one returns clients' phone numbers. `create or
-- replace` keeps the existing grants; they are set again so a re-run on a
-- database where they drifted still ends in the right state.
revoke execute on function public.whatsapp_destinatarios_plazo() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_plazo() to service_role;

insert into public.schema_migrations (key, description)
values (
  '168_el_recordatorio_cuenta_en_la_zona_del_negocio',
  'whatsapp_destinatarios_plazo() cuenta el día del vencimiento y el «hoy» en la zona de cada negocio (Caracas para Venezuela, Bogotá para Colombia), como la pantalla desde PL-1. Antes era Bogotá para todos: una cuota venezolana que vencía entre las 00:00 y las 00:59 de Caracas se avisaba un día antes y con la fecha del día anterior. Medido en dev el 2026-10-31.'
)
on conflict (key) do nothing;

commit;
