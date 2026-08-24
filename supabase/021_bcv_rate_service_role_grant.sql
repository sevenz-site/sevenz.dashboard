-- Follow-up to 020. Run once in the SQL editor, DEV Supabase project only.
--
-- The exchange-rate fetch route writes as the service role (see
-- lib/supabase/service.ts) because bcv_exchange_rate_fetches deliberately
-- grants no insert access to authenticated/anon. service_role bypasses RLS,
-- but it still needs table-level privileges — and this project doesn't rely
-- on Supabase's automatic default privileges (that's why every table in
-- schema.sql carries its own explicit grant). 020 granted select to
-- authenticated but nothing to service_role, so the insert failed with
-- "permission denied for table bcv_exchange_rate_fetches".

grant select, insert on public.bcv_exchange_rate_fetches to service_role;
