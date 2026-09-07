-- ENVIRONMENT: run in DEV ONLY — dev branch (vzqppwrwnmlbrxizskdh).
-- NEVER run this in production (rabmiyqodnvnrwiartuj). Production is already
-- in the state this file is trying to reach; running it there would revoke
-- privileges and re-grant them, which is a no-op at best and an outage at
-- worst if the two lists have drifted apart by then.
--
-- WHAT THIS IS. Branch creation does not clone grants (CLAUDE.md already
-- records the same gap for auth.users triggers and Storage buckets), so the
-- dev branch kept Supabase's wide defaults: every table in `public` grants
-- SELECT/INSERT/UPDATE/DELETE to anon, authenticated AND service_role.
-- Production grants `anon` nothing that reads or writes. Measured 2026-09-07
-- during the Papelera qa-regression-checklist.
--
-- NOTHING IS LEAKING TODAY, and that was measured rather than assumed: with
-- the dev anon key, `client_summary_all` and `client_hides` both return zero
-- rows, because RLS is what actually stops the caller. The grants are loose;
-- the policies are not.
--
-- The cost is that **dev cannot validate production's permissions**. Code that
-- fails in production for a missing grant passes in dev. That is exactly the
-- 2026-09-05 outage: /admin returned `permission denied for table owners` in
-- production and worked fine in dev. It also means dev is one bad RLS policy
-- away from a real leak, where production would still need two mistakes.
--
-- SCOPE: anon and authenticated only.
--
-- service_role is deliberately LEFT ALONE, and as of 2026-09-07 that is the
-- final answer rather than a deferral. The qa/ scripts read and write tables
-- with that key on purpose — they provision fixtures — and they only ever run
-- against dev, so tightening dev would break the test harness in order to catch
-- a mistake in application code. analytics/* no longer needs it either: both
-- scripts now go through lib/admin/metrics.ts and work against production.
--
-- The rule that grant alignment was standing in for is enforced directly now:
-- "npm run qa:service-role" fails if anything under app/, lib/, components/ or
-- hooks/ reads a table with the service-role client, allowing only
-- bcv_exchange_rate_fetches — the one table production grants it. It runs in
-- seconds, in every environment, and is in the qa-regression-checklist skill.
--
-- None of the application four service_role paths were ever affected: /s/[token]
-- rate limiting, lib/admin/metrics.ts, lib/admin/health.ts and the BCV fetch all
-- go through SECURITY DEFINER functions or that one granted table.
--
-- SAFETY: every public surface reaches the database through a SECURITY DEFINER
-- function, never a table — get_shared_balance, submit_shared_document_id,
-- claim_rate_limit_quota. Function EXECUTE grants are a separate ACL from
-- table grants and are untouched here, so revoking anon's table privileges
-- cannot break the share link. Verified by grepping app/s and
-- components/public for `.from(` — zero direct table reads.
--
-- PREREQUISITE: run 044 in dev first (already done 2026-09-07). This file
-- re-grants client_summary_all and client_hides, so it must know they exist.
begin;

-- ── 1. anon loses every data privilege ──────────────────────────────────
-- Nothing legitimate uses them. REFERENCES, TRIGGER and TRUNCATE are left in
-- place because production has them too — the target is parity, not maximum
-- strictness, so that any future difference is a real signal rather than
-- noise this file introduced.
revoke select, insert, update, delete on all tables in schema public from anon;

-- ── 2. authenticated is reset, then re-granted production's exact set ────
-- Revoke-then-grant rather than a per-table diff: the diff is what drifts. A
-- full reset means this file's grant list IS the specification, and re-running
-- it converges rather than accumulating. Inside one transaction, so there is
-- no window where a signed-in owner is locked out.
revoke select, insert, update, delete on all tables in schema public from authenticated;

-- Read-only: the strip and the calculator show the rate; only the cron writes.
grant select on public.bcv_exchange_rate_fetches to authenticated;

-- Mala paga: flag, unflag (an update that closes the row), and read history.
-- No delete — a flag cycle is history and is never removed.
grant select, insert, update on public.client_flags to authenticated;

-- The two views. client_summary is what every list screen reads;
-- client_summary_all is the Papelera, the client detail page and
-- get_shared_balance. Both read-only by nature.
grant select on public.client_summary to authenticated;
grant select on public.client_summary_all to authenticated;

-- Papelera transitions. Insert to record one, update to mark it read.
grant select, insert, update on public.client_hides to authenticated;

grant select, insert, update, delete on public.clients to authenticated;

grant select, insert, update on public.import_notifications to authenticated;

-- No insert: the row is written by get_shared_balance, which is SECURITY
-- DEFINER and therefore does not need the owner to hold the privilege. The
-- owner only reads the notification and marks it read.
grant select, update on public.link_opens to authenticated;

grant select, insert, update on public.movement_deletions to authenticated;

grant select, insert, update, delete on public.movements to authenticated;

grant select, insert, update on public.owner_exchange_settings to authenticated;

grant select, insert, update, delete on public.owners to authenticated;

grant select, insert, update, delete on public.share_links to authenticated;

-- Deliberately NOT granted, matching production exactly:
--   applied_data_migrations, client_identities, rate_limit_counters,
--   rate_limiters, schema_migrations
-- These are infrastructure. `client_identities` is the one worth naming: it
-- holds the future client-login identities from 035, and an owner session has
-- no business reading it.

-- ── 3. stop the next migration from reopening everything ────────────────
-- This is the half that is easy to forget and makes the other two pointless.
--
-- MEASURED, not deduced. pg_default_acl in both environments on 2026-09-07:
--
--   granting role `postgres`, object type `tables`:
--     production   anon / authenticated / service_role
--                  -> MAINTAIN, REFERENCES, TRIGGER, TRUNCATE
--     dev          anon / authenticated / service_role
--                  -> the same PLUS DELETE, INSERT, SELECT, UPDATE
--
-- That is the whole explanation for client_hides being born wide open in dev
-- and correctly strict in production on 2026-09-07, from the same migration.
-- Someone tightened production's postgres defaults; the dev branch never got
-- it, because branch creation does not clone this either.
--
-- `for role postgres` is explicit on purpose. ALTER DEFAULT PRIVILEGES without
-- it silently targets the *current* role, so if the SQL editor ever ran as
-- something else this would report success and change nothing — the same trap
-- as 041, where `revoke ... from anon` ran clean and left the function fully
-- callable because the real grant came from PUBLIC. Migrations here run as
-- postgres, and the row above proves postgres is the role that governs.
--
-- The supabase_admin rows in pg_default_acl are identical in both environments
-- and are deliberately left alone: they only apply to objects created by that
-- role, and no migration in this project runs as it.
--
-- service_role is left out here too, matching section 2 scope. Its defaults stay
-- wide in dev, so a table created by a future migration is still open to
-- service_role there and strict in production. That is deliberate: it is what
-- keeps the qa/ fixture scripts working, and the risk it used to stand for is
-- now caught by "npm run qa:service-role" instead.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from authenticated;

insert into public.schema_migrations (key, description)
values (
  '045_dev_grant_parity',
  'DEV ONLY. Brings anon and authenticated table grants in line with production, which branch creation never cloned, and closes the default privileges that were re-opening every newly created table. service_role deliberately untouched.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
-- Run in DEV (vzqppwrwnmlbrxizskdh) and in PRODUCTION (rabmiyqodnvnrwiartuj),
-- then diff the two results. Only client_hides, client_summary_all and
-- service_role rows should differ — the first two because production gets them
-- from 044, the last because it is out of scope here.
--
--   select table_name, grantee,
--          string_agg(privilege_type, ', ' order by privilege_type) as privileges
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated')
--   group by table_name, grantee
--   order by table_name, grantee;
--
-- And the default privileges, which the query above cannot see:
--
--   select r.rolname as granted_by, n.nspname as schema,
--          a.defaclobjtype as obj_type, a.defaclacl as acl
--   from pg_default_acl a
--   join pg_roles r on r.oid = a.defaclrole
--   join pg_namespace n on n.oid = a.defaclnamespace
--   where n.nspname = 'public';
