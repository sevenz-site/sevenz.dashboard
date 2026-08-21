-- Lets an owner flag a client as "Mala paga" (won't extend more credit) with
-- a required reason, reversibly. Mirrors the movements.deleted_at /
-- movement_deletions soft-delete + log pattern from 021: the flag itself is a
-- fast boolean on clients for filtering/badges, and client_flags is the
-- permanent audit trail of every flag/unflag cycle (a client can be flagged
-- and unflagged more than once, so this is a log, not a single row).

alter table public.clients
  add column if not exists is_flagged boolean not null default false;

create table if not exists public.client_flags (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  reason text not null,
  flagged_at timestamptz not null default now(),
  unflagged_at timestamptz
);

create index if not exists client_flags_client_id_idx
  on public.client_flags (client_id, flagged_at desc);

alter table public.client_flags enable row level security;

drop policy if exists "owners manage own client flags" on public.client_flags;
create policy "owners manage own client flags" on public.client_flags
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.client_flags to authenticated;

-- Exposes is_flagged through client_summary so the Cartera table can show
-- the "Mala paga" badge without an extra join.
create or replace view public.client_summary
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
