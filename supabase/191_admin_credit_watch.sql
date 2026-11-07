-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with
-- its own green light, and BEFORE the code (CLAUDE.md, deploy step 1). Nothing in the
-- app calls this until the /admin card ships; the old code keeps working untouched.
-- Re-runnable: drops the one signature it creates, then creates it again.
--
-- ===========================================================================
-- 191: WHICH CREDIT BALANCES BORN FROM A RETURN ARE WORTH A LOOK (B of PL-22)
--
-- Owner's decision of 2026-11-05: *«Vamos con B, C1 y C2. B nunca debe bloquear
-- transacciones, solo avisar a admin»*. Finding A4 of the returns audit: with a stolen
-- session, a sale can be fabricated and returned «a favor», leaving spendable credit
-- that the ledger cannot tell from a real one.
--
-- THIS FUNCTION ONLY READS. It does not touch `registrar_devolucion_contado`, the
-- rules of 180 or `ledger_rule_hits` (which PL-21 reads to decide when to enforce). A
-- return already leaves everything B needs: `sale_returns.to_credit`, the sale it came
-- from and both dates. B asks a question about rows that exist; nothing is blocked.
--
-- WHY A DEFINER: /admin reads with the service role, and production grants that role
-- no customer table (qa:service-role enforces it). Same pattern as
-- `admin_whatsapp_cron_salud` (071). Service role only: an owner session has nothing
-- to read here, and this returns other businesses' names.
--
-- THE THRESHOLDS ARE PARAMETERS, not constants of this function: the rule lives in
-- `lib/returns/credit-watch.ts` and is passed in, so the card, the daily check and
-- the QA suite cannot drift apart. COP gets its own floor because a COP ledger stores
-- pesos (currency null), where 20 is nothing.
-- ===========================================================================

begin;

drop function if exists public.admin_credit_watch(integer, numeric, numeric, integer);

create function public.admin_credit_watch(
  p_days integer,
  p_min_credit numeric,
  p_min_credit_cop numeric,
  p_max_hours integer
)
returns table (
  business_name text,
  owner_country text,
  currency text,
  to_credit numeric,
  sale_created_at timestamptz,
  returned_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    o.business_name,
    o.country,
    r.currency,
    r.to_credit,
    s.created_at,
    r.created_at
  from public.sale_returns r
  join public.sales s on s.id = r.sale_id
  join public.owners o on o.id = r.owner_id
  where r.deleted_at is null
    and r.to_credit >= case when r.currency is null then p_min_credit_cop else p_min_credit end
    and r.created_at >= now() - make_interval(days => p_days)
    and r.created_at - s.created_at <= make_interval(hours => p_max_hours)
  order by r.created_at desc
  limit 50;
$fn$;

-- All three roles by name, as 039 and 178 require: `revoke ... from public` alone
-- leaves anon and authenticated with the EXECUTE Supabase granted them.
revoke execute on function public.admin_credit_watch(integer, numeric, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.admin_credit_watch(integer, numeric, numeric, integer)
  to service_role;

insert into public.schema_migrations (key, description)
values (
  '191_admin_credit_watch',
  'admin_credit_watch: lectura para /admin de las devoluciones a favor recientes sobre ventas recientes (B de PL-22). Solo lee; no bloquea nada. Solo service_role.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ──────────────────────────────────
--   select proname, prosecdef from pg_proc where proname = 'admin_credit_watch';  -- 1 row, t
--   select has_function_privilege('authenticated',
--     'public.admin_credit_watch(integer, numeric, numeric, integer)', 'execute');   -- false
--   select has_function_privilege('service_role',
--     'public.admin_credit_watch(integer, numeric, numeric, integer)', 'execute');   -- true
