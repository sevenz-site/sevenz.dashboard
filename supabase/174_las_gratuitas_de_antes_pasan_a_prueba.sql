-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). In production it runs
-- ON LAUNCH DAY, after 169 and 171 (it uses `admin_zona` and `fin_de_prueba`), because the date it
-- writes is «3 months from the day this runs». Re-runnable: an account that
-- already got its line from this migration is never touched again.
--
-- ===========================================================================
-- 174: THE FREE ACCOUNTS FROM BEFORE 2026-09-15 GET THEIR 3 MONTHS TOO
--
-- Found on 2026-11-02 reading the production price list for 173: 18 of the 21
-- accounts are «activa · free», with no end date. 057 created them that way
-- for every business that existed on 2026-09-15. 171's rule only blocks an
-- `activa` account when `periodo_termina_el` has passed, and 171's backfill
-- only covered accounts with NO row -- so these 18 would have kept writing,
-- free, forever, while everyone signing up after launch gets 3 months.
--
-- The owner's decision that day, asked with the three options and their
-- edges: «3 meses desde el lanzamiento». Not from their signup (most would be
-- blocked on launch day, with no warning, while using the app daily), and not
-- left free (the automatic block would then reach almost none of today's
-- customers).
--
-- WHO, EXACTLY: `estado = 'activa'`, `plan_code = 'free'`, no paid period.
-- Pro accounts at price 0 (the demo business «Mini abasto El Chino», «Mj»)
-- are NOT included -- the owner's decision the same day: «Dejarlas como
-- están». They are courtesy or internal accounts.
--
-- THE GUARD AGAINST A RE-RUN: if an admin later puts someone back on an
-- open-ended free plan on purpose, running this file again must not undo it.
-- So an account that already has this migration's history line is skipped.
--
-- WHAT THIS DOES NOT SOLVE, said out loud: on the end date all of them expire
-- on the same day, and today nothing in the app tells an owner how many days
-- of trial are left. That is a separate piece of work, proposed the same day.

begin;

with candidatas as (
  select s.owner_id, s.plan_code, o.country
  from public.subscriptions s
  join public.owners o on o.id = s.owner_id
  where s.estado = 'activa'
    and s.plan_code = 'free'
    and s.periodo_termina_el is null
    and not exists (
      select 1 from public.subscription_events e
      where e.owner_id = s.owner_id
        and e.motivo like 'Prueba de 3 meses desde el lanzamiento%'
    )
),
cambiadas as (
  update public.subscriptions s
  set estado = 'demo',
      demo_termina_el = public.fin_de_prueba(now(), c.country),
      updated_at = now()
  from candidatas c
  where s.owner_id = c.owner_id
  returning s.owner_id, c.plan_code, c.country, s.demo_termina_el
)
insert into public.subscription_events
  (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
select owner_id, 'sistema', 'activa', 'demo', plan_code, plan_code,
       'Prueba de 3 meses desde el lanzamiento (migración 174): termina el '
       || to_char(demo_termina_el at time zone public.admin_zona(country), 'YYYY-MM-DD')
from cambiadas;

insert into public.schema_migrations (key, description)
values (
  '174_las_gratuitas_de_antes_pasan_a_prueba',
  'Las cuentas «activa · free» sin fecha de fin (creadas por la 057 para los negocios de antes del 2026-09-15) pasan a prueba de 3 meses contados desde el día en que corre esta migración. Decisión del dueño el 2026-11-02. Las Pro a precio 0 no se tocan. Va DESPUÉS de la 171 y en producción se corre el día del lanzamiento.'
)
on conflict (key) do nothing;

commit;
