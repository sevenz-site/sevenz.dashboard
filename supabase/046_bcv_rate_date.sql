-- ENVIRONMENT: run in DEV ONLY for now — dev branch (vzqppwrwnmlbrxizskdh).
-- Do NOT run this in production (rabmiyqodnvnrwiartuj) until the fix is
-- approved for launch and qa-regression-checklist has been run.
--
-- Stores the day a BCV rate actually belongs to, which until now was thrown
-- away on arrival.
--
-- THE BUG. ve.dolarapi.com returns the rate together with its own publication
-- date — {"promedio": 807.3862, "fechaActualizacion": "2026-09-04T00:00:00-04:00"}.
-- DolarApiProvider read `promedio` and dropped `fechaActualizacion`, this table
-- had nowhere to put it, and the rate strip filled the gap with the only date
-- it had: `fetched_at`, the moment our cron ran. It then rendered that as
-- "Tasa BCV del 6 sept." — a sentence about which rate this is, answered with
-- when we asked for it.
--
-- The BCV does not publish on weekends or holidays. Measured 2026-09-07: the
-- official series runs 3 sep, 4 sep, then straight to 7 sep — nothing for the
-- 5th or 6th. The cron ran on Sunday the 6th at 23:36 Caracas, received
-- Friday the 4th's rate, and labelled it "del 6 sept.". No such rate has ever
-- existed, which is why the 90-day table directly underneath had no row for
-- that date. The owner was told their number was two days fresher than it was.
--
-- Nullable, and deliberately NOT backfilled. Every existing row's true rate
-- date is unknowable from what was stored — deriving it from fetched_at is
-- exactly the mistake this migration exists to undo, and it would bake today's
-- wrong answer into the record permanently. The UI shows no date for a row
-- without one, and the daily cron fills every environment within 24h.
begin;

alter table public.bcv_exchange_rate_fetches
  add column if not exists rate_date date;

comment on column public.bcv_exchange_rate_fetches.rate_date is
  'The day the BCV rate itself belongs to, from the provider''s own fechaActualizacion. NOT fetched_at, which is when we asked — those differ every weekend and holiday. Null for rows stored before 046, and for the currency-api fallback, which publishes no date.';

-- Dropped and recreated rather than replaced: `create or replace function`
-- cannot change a RETURNS TABLE signature, and adding a column changes it.
-- Nothing depends on this in a way Postgres tracks — get_shared_balance calls
-- it from inside a plpgsql body, and selects named columns from it, so an
-- extra column is additive there.
drop function if exists public.get_current_bcv_rate();

create function public.get_current_bcv_rate()
returns table (usd numeric, eur numeric, source text, fetched_at timestamptz, rate_date date)
language sql
stable
as $$
  select f.usd, f.eur, f.source, f.fetched_at, f.rate_date
  from public.bcv_exchange_rate_fetches f
  where f.needs_review = false
  order by f.fetched_at desc
  limit 1;
$$;

-- The drop took the ACL with it. `authenticated` is what the schema granted
-- before; `service_role` is added explicitly because lib/admin/health.ts calls
-- this with the service client and until now was executing through Postgres's
-- default EXECUTE-to-PUBLIC — which is the same implicit grant that made 041's
-- revoke look like it had worked when it had not. An explicit grant is a
-- grant you can see.
grant execute on function public.get_current_bcv_rate() to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '046_bcv_rate_date',
  'Adds bcv_exchange_rate_fetches.rate_date (the provider''s own fechaActualizacion) and returns it from get_current_bcv_rate(), so the calculator can label a rate with the day it belongs to instead of the day the cron ran.'
)
on conflict (key) do nothing;

commit;
