-- Run once in the SQL editor, DEV Supabase project only.
--
-- ARCHITECTURE CHANGE, not an additive migration. For a country='VE' owner,
-- movements.amount and running_balance now hold USD, not bolívares: the debt
-- is dollar-indexed, so a client who owes $50 still owes $50 tomorrow while
-- the bolívar figure floats with the rate. Bs is never stored as a balance
-- again — it's derived at read time from the current rate.
--
-- USD is the anchor even for owners displaying EUR, so a running balance is
-- always one summable unit and changing display_currency can never corrupt
-- existing debt.
--
-- country='CO' owners are untouched: their amounts stay COP throughout, and
-- the data conversion below is scoped to VE owners only.

-- ── 1. precision ────────────────────────────────────────────────────────
-- numeric(12,2) was right for whole-peso/bolívar amounts. A USD-indexed
-- ledger needs more decimals: Bs. 5.000 is $6.4106…, and rounding that to
-- $6.41 would round-trip back to Bs. 4.999,17 — visibly wrong to an owner
-- who typed exactly 5.000.
-- client_summary selects running_balance, and Postgres refuses to alter a
-- column a view depends on ("cannot alter type of a column used by a view or
-- rule"), so the view has to be dropped and rebuilt around the change.
drop view if exists public.client_summary;

alter table public.movements
  alter column amount type numeric(14, 4),
  alter column running_balance type numeric(14, 4);

create view public.client_summary
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  coalesce(latest.running_balance, 0) as balance,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id,
  c.is_flagged
from public.clients c
left join lateral (
  select m.running_balance
  from public.movements m
  where m.client_id = c.id and m.deleted_at is null
  order by m.created_at desc, m.id desc
  limit 1
) latest on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review
  from public.movements m
  where m.client_id = c.id and m.deleted_at is null
) review on true
left join lateral (
  select m.created_at
  from public.movements m
  where m.client_id = c.id and m.type = 'payment' and m.deleted_at is null
  order by m.created_at desc
  limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary to authenticated;

-- The trigger and recalc helpers declare their own locals, which would
-- silently round back to 2 decimals if left alone.
create or replace function public.set_movement_running_balance()
returns trigger
language plpgsql
as $$
declare
  v_prev numeric(14, 4);
begin
  select running_balance into v_prev
  from public.movements
  where client_id = new.client_id and deleted_at is null
  order by created_at desc, id desc
  limit 1;

  v_prev := coalesce(v_prev, 0);
  new.running_balance := v_prev + (case when new.type = 'charge' then new.amount else -new.amount end);

  return new;
end;
$$;

create or replace function public.recalc_client_running_balance(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  m record;
  running numeric(14, 4) := 0;
begin
  for m in
    select id, type, amount
    from public.movements
    where client_id = p_client_id and deleted_at is null
    order by created_at asc, id asc
  loop
    running := running + (case when m.type = 'charge' then m.amount else -m.amount end);
    update public.movements set running_balance = running where id = m.id;
  end loop;
end;
$$;

grant execute on function public.recalc_client_running_balance(uuid) to authenticated;

-- ── 2. convert existing VE movements from Bs to USD ─────────────────────
-- Guarded by a marker row: this rewrites real amounts, and running it a
-- second time would divide them by the rate twice. The guard makes the
-- whole file safe to re-run.
create table if not exists public.applied_data_migrations (
  key text primary key,
  applied_at timestamptz not null default now()
);

-- Internal bookkeeping, never read by app code. RLS on with no policies at
-- all = deny by default for anon/authenticated; the DO block below runs as
-- postgres, which owns the table and bypasses RLS.
alter table public.applied_data_migrations enable row level security;

do $$
declare
  r record;
  v_rate numeric;
begin
  if exists (select 1 from public.applied_data_migrations where key = '024_usd_indexed_ledger') then
    raise notice '024 data conversion already applied — skipping.';
    return;
  end if;

  select usd into v_rate from public.get_current_bcv_rate();

  -- Uses the rate snapshot written with each movement; falls back to the
  -- current official rate for rows written before those snapshots existed.
  -- Deliberately does NOT fall back to exchange_rate_used: on a EUR-entered
  -- movement that column holds the EUR rate, which would yield euros here.
  update public.movements m
  set amount = m.amount / nullif(coalesce(m.rate_usd_at_time, v_rate), 0)
  where m.client_id in (
    select c.id from public.clients c
    join public.owners o on o.id = c.owner_id
    where o.country = 'VE'
  )
  and coalesce(m.rate_usd_at_time, v_rate) is not null;

  -- Rebuild running balances for every affected client.
  for r in
    select distinct c.id
    from public.clients c
    join public.owners o on o.id = c.owner_id
    where o.country = 'VE'
  loop
    perform public.recalc_client_running_balance(r.id);
  end loop;

  insert into public.applied_data_migrations (key) values ('024_usd_indexed_ledger');
end
$$;
