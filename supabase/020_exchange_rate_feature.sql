-- Additive migration: run once in the SQL editor, DEV Supabase project only
-- for now (this feature is being built on the dev branch first). Doesn't
-- touch existing data — every new column is nullable or has a safe default,
-- so every existing COP owner/movement is completely unaffected.
--
-- Deviations from the original design doc, after auditing the real schema:
-- - movements.rate_mode_used / exchange_rate_used / official_bcv_rate_at_time
--   are nullable here (the doc had rate_mode_used NOT NULL). Forcing NOT NULL
--   would break every existing COP movement, which has nothing to do with
--   Bs/BCV at all. Only movements recorded by a country='VE' owner ever
--   populate these.
-- - owner_exchange_settings has no row for most owners (COP owners never
--   get one; a VE owner without one yet implicitly means BCV_AUTO + USD).
--   The settings screen upserts a row only when the owner actually saves.
-- - Added owners.country and public.bcv_exchange_rate_fetches — needed to
--   gate the whole feature per-owner and to store the fetched-rate history,
--   neither of which existed in the current schema.

-- ── owners.country ─────────────────────────────────────────────────────
-- Gates the entire exchange-rate feature: only 'VE' owners see any of the
-- new UI (Ajustes → Tasa de cambio, the rate strip, currency selects on
-- movements). 'CO' is the default so every existing owner is unaffected.
alter table public.owners
  add column if not exists country text not null default 'CO' check (country in ('CO', 'VE'));

-- ── owner_exchange_settings: one row per owner who has configured this ──
create table if not exists public.owner_exchange_settings (
  owner_id uuid primary key references public.owners (id) on delete cascade,
  rate_mode text not null default 'BCV_AUTO' check (rate_mode in ('BCV_AUTO', 'CUSTOM')),
  custom_rate_usd numeric,
  custom_rate_eur numeric,
  custom_rate_set_at timestamptz,
  display_currency text not null default 'USD' check (display_currency in ('USD', 'EUR')),
  updated_at timestamptz not null default now()
);

alter table public.owner_exchange_settings enable row level security;

drop policy if exists "owners manage own exchange settings" on public.owner_exchange_settings;
create policy "owners manage own exchange settings" on public.owner_exchange_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.owner_exchange_settings to authenticated;

-- ── bcv_exchange_rate_fetches: history of the background rate job ──────
-- Global reference data, not owner-scoped: every VE owner reads the same
-- official rate. needs_review = true means this fetch jumped >15% from the
-- last accepted fetch and is stored for the record, but is skipped by
-- get_current_bcv_rate() below — it never becomes "the" official rate on
-- its own.
create table if not exists public.bcv_exchange_rate_fetches (
  id uuid primary key default gen_random_uuid(),
  usd numeric not null,
  eur numeric not null,
  source text not null,
  needs_review boolean not null default false,
  fetched_at timestamptz not null default now()
);

create index if not exists bcv_exchange_rate_fetches_fetched_at_idx
  on public.bcv_exchange_rate_fetches (fetched_at desc);

alter table public.bcv_exchange_rate_fetches enable row level security;

-- Authenticated owners can read the history/current rate directly (used by
-- the rate strip and settings screen). Anonymous access for the public
-- client screen goes through get_shared_balance() instead, same pattern as
-- the rest of this schema — no direct anon grant on the table itself.
drop policy if exists "authenticated read bcv rate fetches" on public.bcv_exchange_rate_fetches;
create policy "authenticated read bcv rate fetches" on public.bcv_exchange_rate_fetches
  for select to authenticated using (true);

grant select on public.bcv_exchange_rate_fetches to authenticated;
-- The fetch route runs as the service role (bypasses RLS), so no insert
-- grant is needed for authenticated/anon.

-- Returns the most recent fetch that wasn't flagged for review — this is
-- "the" official BCV rate used everywhere (badge text, official_bcv_rate_
-- at_time snapshots, the rate strip). An anomalous fetch is recorded but
-- never surfaces here until a later, non-anomalous fetch supersedes it.
create or replace function public.get_current_bcv_rate()
returns table (usd numeric, eur numeric, source text, fetched_at timestamptz)
language sql
stable
as $$
  select f.usd, f.eur, f.source, f.fetched_at
  from public.bcv_exchange_rate_fetches f
  where f.needs_review = false
  order by f.fetched_at desc
  limit 1;
$$;

grant execute on function public.get_current_bcv_rate() to authenticated;

-- ── movements: snapshot of the rate actually applied ────────────────────
-- Nullable — see the note at the top of this file. Only ever populated for
-- movements recorded by a country='VE' owner.
alter table public.movements
  add column if not exists rate_mode_used text check (rate_mode_used in ('BCV_AUTO', 'CUSTOM')),
  add column if not exists exchange_rate_used numeric,
  add column if not exists official_bcv_rate_at_time numeric;

-- ── get_shared_balance(): expose document_id's neighbor, the live official
-- rate, so the public client screen can render the CUSTOM-mode badge's
-- "no es la tasa oficial BCV (X hoy)" text without a second round-trip ────
create or replace function public.get_shared_balance(p_token text)
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
  v_balance numeric(12, 2);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_current_bcv record;
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
  on conflict (client_id, opened_date) do nothing;

  select business_name, whatsapp, logo_path, payment_info, country
    into v_business, v_owner_whatsapp, v_owner_logo_path, v_payment_info, v_owner_country
  from public.owners where id = v_client.owner_id;

  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'plazo_dias', m.plazo_dias,
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from public.movements m
  where m.client_id = v_client.id and m.deleted_at is null;

  select running_balance into v_balance
  from public.movements
  where client_id = v_client.id and deleted_at is null
  order by created_at desc, id desc
  limit 1;

  if v_owner_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_client.owner_id;
    select * into v_current_bcv from public.get_current_bcv_rate();
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    'payment_info', v_payment_info,
    'client_name', v_client.name,
    'document_id', v_client.document_id,
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'movements', coalesce(v_movements, '[]'::json),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'display_currency', coalesce(v_settings.display_currency, 'USD'),
    'current_bcv_usd', v_current_bcv.usd,
    'current_bcv_eur', v_current_bcv.eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

grant execute on function public.get_shared_balance(text) to anon, authenticated;
