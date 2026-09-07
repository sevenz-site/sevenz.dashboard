-- ENVIRONMENT: run in DEV ONLY for now — dev branch (vzqppwrwnmlbrxizskdh).
-- Do NOT run this in production (rabmiyqodnvnrwiartuj) until the Papelera
-- feature is approved for launch and the qa-regression-checklist has been run.
--
-- Phase 1 of PAPELERA-PLAN.md: the schema and the one filter everything else
-- depends on. No UI ships with this file alone.
--
-- WHY THE FILTER LIVES IN THE VIEW. 29 code paths read clients. Adding a
-- "and not hidden" clause to each is 29 chances to forget one, and a forgotten
-- one fails silently in the worst direction: a client the owner believes is
-- gone reappears in a list. Filtering inside client_summary makes the safe
-- behaviour the default — a query nobody updates shows too little, never too
-- much — and client_summary_all exists for the places that legitimately need
-- to see hidden clients (the Papelera screen, /admin metrics, and the client's
-- own share link).
begin;

-- ── 1. the two hiding states, plus the balance snapshot ─────────────────
-- Two nullable timestamps rather than a status enum, matching
-- movements.deleted_at, which is this codebase's existing soft-delete shape.
--
-- trashed_balance_* is not redundant with the ledger. Hiding a client with
-- $200 owed drops "Capital por cobrar" by $200 (decision D2), and without a
-- snapshot nothing on any later screen can explain why last week's total and
-- this week's disagree. Three columns, not one: USD and EUR are never summed
-- anywhere in this app and must not start here.
alter table public.clients
  add column if not exists trashed_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists trashed_balance numeric(14, 4),
  add column if not exists trashed_balance_usd numeric(14, 4),
  add column if not exists trashed_balance_eur numeric(14, 4);

comment on column public.clients.trashed_at is
  'Papelera (layer 2). Reversible by the owner. Independent of is_flagged — a client need not be mala paga to be trashed (D6).';
comment on column public.clients.deleted_at is
  'Ocultar definitivamente (layer 3). Not deletion: the row, the history and the share link all survive (D1, D3).';

-- Every owner-facing list reads "this owner's visible clients", so that is the
-- shape the index should have.
create index if not exists clients_owner_visible_idx
  on public.clients (owner_id)
  where trashed_at is null and deleted_at is null;

-- ── 2. client_summary_all — the unfiltered view ─────────────────────────
-- Byte-identical to the client_summary defined in 025, with five columns
-- appended. Deliberately a copy rather than a clever refactor: this is the
-- query every screen in the app depends on, and the diff being readable
-- matters more than the duplication.
create or replace view public.client_summary_all
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  coalesce(latest_cop.running_balance, 0) as balance,
  coalesce(latest_usd.running_balance, 0) as balance_usd,
  coalesce(latest_eur.running_balance, 0) as balance_eur,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id,
  c.is_flagged,
  c.trashed_at,
  c.deleted_at,
  c.trashed_balance,
  c.trashed_balance_usd,
  c.trashed_balance_eur
from public.clients c
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency is null and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_cop on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'USD' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_usd on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'EUR' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_eur on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review from public.movements m
  where m.client_id = c.id and m.deleted_at is null
) review on true
left join lateral (
  select m.created_at from public.movements m
  where m.client_id = c.id and m.type = 'payment' and m.deleted_at is null
  order by m.created_at desc limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary_all to authenticated;

-- ── 3. client_summary becomes the filtered one ──────────────────────────
-- Dropped and recreated rather than `create or replace`: replace can only
-- append columns and refuses any change to the ones already there, so it would
-- either fail or quietly keep the old body depending on how the new column
-- list lined up. Nothing in the database depends on this view — the only other
-- reader, get_shared_balance, references it from inside a plpgsql body, which
-- Postgres does not track as a dependency (and which section 5 repoints).
drop view if exists public.client_summary;

create view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

-- The drop took the grant with it. Restoring it is not optional: without this
-- line every owner-facing screen in the app returns "permission denied".
grant select on public.client_summary to authenticated;

-- ── 4. client_hides — the notification trail ────────────────────────────
-- Same shape as movement_deletions, on purpose. To an owner, trashing a client
-- is the same gesture as deleting a movement at a different scale: it should
-- produce a notification they can undo from, and it does it the same way.
create table if not exists public.client_hides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- One row per transition, never an updated status: the history of a client
  -- being trashed, restored and trashed again is the thing worth keeping,
  -- exactly as client_flags records every flag/unflag cycle rather than a
  -- boolean.
  action text not null check (action in ('trashed', 'restored', 'hidden')),
  occurred_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists client_hides_owner_id_idx
  on public.client_hides (owner_id, occurred_at desc);

alter table public.client_hides enable row level security;

drop policy if exists "owners manage own client hides" on public.client_hides;
create policy "owners manage own client hides" on public.client_hides
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.client_hides to authenticated;

-- ── 5. the share link must keep working for a hidden client ─────────────
-- Decision D3: the link belongs to the client, not the owner, and it is the
-- path by which a forgotten debt gets paid. get_shared_balance reads
-- client_summary, which section 3 just taught to hide trashed clients — so
-- without this the balance on a trashed client's link would silently drop to
-- zero and they would believe the debt was cancelled.
--
-- BASE: 043_shared_balance_drops_document_and_payment.sql. The ONLY change is
-- one line: `from public.client_summary` becomes `from public.client_summary_all`.
-- Everything else is byte-identical, deliberately.
create or replace function public.get_shared_balance(p_token text, p_limit int default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
  v_owner_whatsapp text;
  v_owner_logo_path text;
  v_payment_info text;
  v_movements json;
  v_movement_total int;
  v_balance numeric(14, 4);
  v_balance_usd numeric(14, 4);
  v_balance_eur numeric(14, 4);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
begin
  select c.* into v_client
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if not found then
    return null;
  end if;

  insert into public.link_opens (client_id, opened_date)
  values (v_client.id, current_date)
  on conflict (client_id, opened_date) do update
    set read_at = null,
        opened_at = now();

  select business_name, whatsapp, logo_path, payment_info, country
    into v_business, v_owner_whatsapp, v_owner_logo_path, v_payment_info, v_owner_country
  from public.owners where id = v_client.owner_id;

  select count(*) into v_movement_total
  from public.movements
  where client_id = v_client.id and deleted_at is null;

  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'currency', m.currency,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'plazo_dias', m.plazo_dias,
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'official_bcv_rate_at_time', m.official_bcv_rate_at_time,
      'entry_currency', m.entry_currency,
      'entry_amount', m.entry_amount,
      'rate_usd_at_time', m.rate_usd_at_time,
      'rate_eur_at_time', m.rate_eur_at_time,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from (
    select *
    from public.movements
    where client_id = v_client.id and deleted_at is null
    order by created_at desc
    limit p_limit
  ) m;

  -- The one changed line. client_summary now excludes hidden clients; this
  -- function is the one reader that must still see them.
  select coalesce(balance, 0), coalesce(balance_usd, 0), coalesce(balance_eur, 0)
    into v_balance, v_balance_usd, v_balance_eur
  from public.client_summary_all where client_id = v_client.id;

  if v_owner_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_client.owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    'client_name', v_client.name,
    'has_document_id', (v_client.document_id is not null and trim(v_client.document_id) <> ''),
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'balance_usd', coalesce(v_balance_usd, 0),
    'balance_eur', coalesce(v_balance_eur, 0),
    'movements', coalesce(v_movements, '[]'::json),
    'movement_total', coalesce(v_movement_total, 0),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

grant execute on function public.get_shared_balance(text, int) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '044_client_papelera',
  'Papelera phase 1: clients.trashed_at/deleted_at plus a trashed_balance snapshot, client_summary now excludes hidden clients, new unfiltered client_summary_all, client_hides notification trail, and get_shared_balance repointed so a hidden client share link keeps showing their balance.'
)
on conflict (key) do nothing;

commit;
