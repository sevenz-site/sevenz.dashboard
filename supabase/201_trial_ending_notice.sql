-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that calls it (CLAUDE.md, deploy step 1). Nothing in
-- production calls this function today.
-- Re-runnable: drop + create, `on conflict` on the ledger row.
--
-- ===========================================================================
-- 201: WHO GETS `prueba_por_vencer`, «TU PRUEBA DE SEVENZ TERMINA EL …»
--
-- Approved by Meta on 2026-11-07. Owner's decision of 2026-11-12 that it ships in v0.6.0
-- with the rest of the approved family, and «Solo los de 7 días»: it goes to an account
-- whose trial ends EXACTLY 7 calendar days from today, in the business's own zone, and to
-- nobody closer. Said out loud because it is the cost of that decision: the accounts already
-- inside the last week on launch day never get it, and if the cron fails on an account's
-- day-7 morning, that account never gets it either.
--
-- It is the only «tercer mensaje extraordinario» (CLAUDE.md, «Un tendero recibe dos mensajes
-- a la semana»): it takes no Monday or Thursday slot, because an account can lose something
-- by not knowing.
--
-- WHO, in one place:
--   - in trial (`demo`), not a test account, with the end date exactly 7 days ahead;
--   - a number, an opt-in, and no later opt-out (same rule as every owner message);
--   - never sent before with success. A failed send does not block a retry the same day:
--     the send gate (067) frees the turn.
--
-- «EXACTLY 7 DAYS» IS A DATE, NOT 168 HOURS. `demo_termina_el` is the last second of the end
-- day in the business's zone (`fin_de_prueba`, 171). Both dates are taken in that zone, the
-- way the shopkeeper counts: a trial ending «el 6 de febrero» is warned on 30 January.
--
-- Server only.
-- ===========================================================================

begin;

drop function if exists public.trial_ending_targets();
drop function if exists public.trial_ending_targets(integer);
create function public.trial_ending_targets(p_days_ahead integer default 7)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
           'owner_id', o.id,
           'whatsapp', o.whatsapp,
           'first_name', o.first_name,
           'business_name', o.business_name,
           'country', o.country,
           'trial_ends_at', s.demo_termina_el
         )
    from public.owners o
    join public.subscriptions s on s.owner_id = o.id
   where s.estado = 'demo'
     and not s.is_test_account
     and s.demo_termina_el is not null
     and (s.demo_termina_el at time zone (case when o.country = 'VE' then 'America/Caracas' else 'America/Bogota' end))::date
       - (now() at time zone (case when o.country = 'VE' then 'America/Caracas' else 'America/Bogota' end))::date
       = p_days_ahead
     and o.whatsapp is not null
     and btrim(o.whatsapp) <> ''
     and o.whatsapp_opt_in_at is not null
     and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
     and not exists (
       select 1 from public.whatsapp_sends w
        where w.owner_id = o.id and w.template = 'prueba_por_vencer' and w.ok is true
     );
$fn$;

revoke execute on function public.trial_ending_targets(integer) from public, anon, authenticated;
grant execute on function public.trial_ending_targets(integer) to service_role;

insert into public.schema_migrations (key, description)
values (
  '201_trial_ending_notice',
  'prueba_por_vencer: a quién le llega «tu prueba de Sevenz termina el …». Solo a cuentas en prueba a las que les quedan exactamente 7 días, contados como fechas en la zona del negocio (decisión del dueño del 2026-11-12), con número y permiso, y una sola vez. Solo del servidor.'
)
on conflict (key) do nothing;

commit;
