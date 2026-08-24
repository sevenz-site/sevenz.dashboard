-- Sevenz (fiado) MVP schema: owners, clients, movements, share_links
-- Run this once against a fresh Supabase project (SQL editor or `supabase db push`).

-- ── owners ──────────────────────────────────────────────────────────────
create table if not exists public.owners (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  business_name text not null default '',
  first_name text,
  last_name text,
  whatsapp text,
  onboarding_completed_at timestamptz,
  address text,
  tax_id text,
  logo_path text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  payment_info text check (char_length(payment_info) <= 500),
  -- Gates the exchange-rate feature end to end: only 'VE' owners see any of
  -- the Bs/BCV UI (Ajustes → Tasa de cambio, rate strip, currency selects on
  -- movements). 'CO' is the default so every existing owner is unaffected.
  country text not null default 'CO' check (country in ('CO', 'VE')),
  created_at timestamptz not null default now()
);

alter table public.owners enable row level security;

create policy "owners select own row" on public.owners
  for select using (id = auth.uid());

create policy "owners update own row" on public.owners
  for update using (id = auth.uid());

-- auto-create an owner row whenever someone signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (id, email, business_name, first_name, last_name, whatsapp)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── clients ─────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  name text not null,
  whatsapp text,
  address text,
  document_id text,
  created_at timestamptz not null default now(),
  -- "Mala paga" flag: reversible, owner-scoped, requires a reason (see
  -- client_flags below for the audit trail of every flag/unflag cycle).
  is_flagged boolean not null default false
);

create index if not exists clients_owner_id_idx on public.clients (owner_id);

alter table public.clients enable row level security;

create policy "owners manage own clients" on public.clients
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── client flags ("Mala paga") ─────────────────────────────────────────
-- Log of every flag/unflag cycle, not a single row — a client can be flagged
-- and later unflagged more than once over the relationship.
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

-- ── movements ───────────────────────────────────────────────────────────
create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  type text not null check (type in ('charge', 'payment')),
  amount numeric(12, 2) not null check (amount > 0),
  description text,
  source text not null default 'manual' check (source in ('photo_import', 'manual')),
  running_balance numeric(12, 2) not null default 0,
  needs_review boolean not null default false,
  photo_path text,
  plazo_dias int check (plazo_dias is null or plazo_dias in (7, 15, 30, 45)),
  created_at timestamptz not null default now(),
  -- Soft-delete: the owner can delete a mistaken movement, and restore it
  -- later from a notification. The row stays put; every balance-reading
  -- query below excludes rows where this is set.
  deleted_at timestamptz,
  -- Exchange-rate snapshot: nullable, only ever populated for movements
  -- recorded by a country='VE' owner. official_bcv_rate_at_time is always
  -- filled in even when rate_mode_used = 'CUSTOM', so a custom-rate dispute
  -- always has an objective, auditable comparison point.
  rate_mode_used text check (rate_mode_used in ('BCV_AUTO', 'CUSTOM')),
  exchange_rate_used numeric,
  official_bcv_rate_at_time numeric
);

create index if not exists movements_client_id_idx on public.movements (client_id, created_at);
create index if not exists movements_client_id_active_idx
  on public.movements (client_id, created_at) where deleted_at is null;

alter table public.movements enable row level security;

create policy "owners manage own movements" on public.movements
  for all using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

-- running_balance is always server-computed: previous balance for the client
-- plus/minus this movement's amount. This is the reconciliation source of truth.
create or replace function public.set_movement_running_balance()
returns trigger
language plpgsql
as $$
declare
  v_prev numeric(12, 2);
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

drop trigger if exists trg_set_movement_running_balance on public.movements;
create trigger trg_set_movement_running_balance
  before insert on public.movements
  for each row execute function public.set_movement_running_balance();

-- Walks a client's non-deleted movements oldest-to-newest and rewrites
-- running_balance on every one of them. Called after a delete or a restore,
-- since either one can shift every balance that came after it. Not
-- SECURITY DEFINER: it runs as the calling owner, so movements RLS quietly
-- limits it to that owner's own clients even if a bad client_id is passed.
create or replace function public.recalc_client_running_balance(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  m record;
  running numeric(12, 2) := 0;
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

-- ── share_links ─────────────────────────────────────────────────────────
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

create policy "owners manage own share links" on public.share_links
  for all using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

-- ── owner_exchange_settings: one row per owner who has configured this ──
-- No row = implicit BCV_AUTO + USD (the settings screen only upserts a row
-- once the owner actually saves). COP owners never get one.
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

create policy "owners manage own exchange settings" on public.owner_exchange_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

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
create policy "authenticated read bcv rate fetches" on public.bcv_exchange_rate_fetches
  for select to authenticated using (true);

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

-- ── grants: RLS governs row access, but the role also needs the base table
-- privileges below or every query fails with "permission denied" before RLS
-- is even evaluated.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.owners to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.movements to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;
grant select, insert, update on public.owner_exchange_settings to authenticated;
grant select on public.bcv_exchange_rate_fetches to authenticated;

-- Walks a client's movements oldest-to-newest, applying payments to charges
-- FIFO (oldest charge first) the way a running balance implicitly does, and
-- returns the date + plazo_dias of whichever charge is still oldest-unpaid.
-- Returns no rows once every charge has been fully paid off.
create or replace function public.get_oldest_unpaid_charge(p_client_id uuid)
returns table (charge_at timestamptz, plazo_dias int)
language plpgsql
stable
as $$
declare
  m record;
  queue_amount numeric[] := '{}';
  queue_at timestamptz[] := '{}';
  queue_plazo int[] := '{}';
  remaining numeric;
  i int;
begin
  for m in
    select mv.type, mv.amount, mv.created_at, mv.plazo_dias
    from public.movements mv
    where mv.client_id = p_client_id and mv.deleted_at is null
    order by mv.created_at asc, mv.id asc
  loop
    if m.type = 'charge' then
      queue_amount := array_append(queue_amount, m.amount);
      queue_at := array_append(queue_at, m.created_at);
      queue_plazo := array_append(queue_plazo, m.plazo_dias);
    else
      remaining := m.amount;
      i := 1;
      while remaining > 0 and i <= coalesce(array_length(queue_amount, 1), 0) loop
        if queue_amount[i] > 0 then
          if queue_amount[i] <= remaining then
            remaining := remaining - queue_amount[i];
            queue_amount[i] := 0;
          else
            queue_amount[i] := queue_amount[i] - remaining;
            remaining := 0;
          end if;
        end if;
        i := i + 1;
      end loop;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
    if queue_amount[i] > 0 then
      charge_at := queue_at[i];
      plazo_dias := queue_plazo[i];
      return next;
      return;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.get_oldest_unpaid_charge(uuid) to authenticated;

-- ── dashboard view: one row per client with balance + days-since-payment ──
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

-- ── link opens: notifies the owner when a client views their shared link ──
create table if not exists public.link_opens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  opened_date date not null default current_date,
  opened_at timestamptz not null default now(),
  read_at timestamptz,
  unique (client_id, opened_date)
);

create index if not exists link_opens_client_id_idx on public.link_opens (client_id);

alter table public.link_opens enable row level security;

create policy "owners view own link opens" on public.link_opens
  for select using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

create policy "owners update own link opens" on public.link_opens
  for update using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

grant select, update on public.link_opens to authenticated;

-- ── import notifications (libreta photo finished/failed) ─────────────────
-- Written by the owner's own authenticated session (not by an anonymous
-- visitor like link_opens), so a normal owner-scoped policy is enough.
create table if not exists public.import_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  file_name text not null,
  status text not null check (status in ('done', 'error')),
  movements_count int,
  error_message text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists import_notifications_owner_id_idx on public.import_notifications (owner_id);

alter table public.import_notifications enable row level security;

create policy "owners manage own import notifications" on public.import_notifications
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.import_notifications to authenticated;

-- ── movement deletions (drives the "movimiento eliminado" notification) ──
-- The movement row itself stays put (soft-deleted, see movements.deleted_at
-- above); this table is only the notification/audit trail — same read_at
-- pattern as import_notifications. A movement can be deleted and restored
-- more than once, so this is a log, not a 1:1 flag: only rows with
-- restored_at is null are still "pending".
create table if not exists public.movement_deletions (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  read_at timestamptz
);

create index if not exists movement_deletions_owner_id_idx on public.movement_deletions (owner_id);

alter table public.movement_deletions enable row level security;

drop policy if exists "owners manage own movement deletions" on public.movement_deletions;
create policy "owners manage own movement deletions" on public.movement_deletions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.movement_deletions to authenticated;

-- ── public read-only access for the client balance page (/s/[token]) ─────
-- No table-level SELECT policy is granted to anon; access is only through
-- this SECURITY DEFINER function, scoped to exactly one client's data.
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
    'current_bcv_eur', v_current_bcv.eur
  );
end;
$$;

grant execute on function public.get_shared_balance(text) to anon, authenticated;

-- ── public business-logo bucket ────────────────────────────────────────
-- Separate from the private `attachments` bucket: a logo is meant to be
-- shown to clients on their public balance page, unlike receipts/ID photos.
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "owners upload own logo"
on storage.objects for insert
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "owners update own logo"
on storage.objects for update
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "owners delete own logo"
on storage.objects for delete
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public reads need no policy (a public bucket serves files by URL without
-- RLS, and a broad SELECT policy would let anon LIST the whole bucket). But
-- the authenticated upload path reads storage.objects before inserting, so
-- owners still need an owner-scoped SELECT policy or uploads fail with
-- "new row violates row-level security policy".
create policy "owners read own logo"
on storage.objects for select
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ── private attachments bucket (receipts, invoices, merchandise, ID photos) ─
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- Files are stored as "{owner_id}/{filename}" — these policies make sure an
-- owner can only touch files under their own folder.
drop policy if exists "owners upload own attachments" on storage.objects;
create policy "owners upload own attachments"
on storage.objects for insert
with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners read own attachments" on storage.objects;
create policy "owners read own attachments"
on storage.objects for select
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners delete own attachments" on storage.objects;
create policy "owners delete own attachments"
on storage.objects for delete
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ── storage.prefixes ───────────────────────────────────────────────────
-- Newer Supabase Storage keeps a folder-index table alongside objects, with
-- its own RLS. An upload writes to both, so without a policy here uploads
-- fail with the same "new row violates row-level security policy" error even
-- when the storage.objects policies are correct. No-op on older projects.
do $outer$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'prefixes'
  ) then
    execute 'grant select, insert, update, delete on storage.prefixes to authenticated';
    execute 'drop policy if exists "owners manage own prefixes" on storage.prefixes';
    execute 'create policy "owners manage own prefixes" on storage.prefixes '
         || 'for all to authenticated '
         || 'using (bucket_id in (''logos'', ''attachments'') '
         || '  and split_part(name, ''/'', 1) = auth.uid()::text) '
         || 'with check (bucket_id in (''logos'', ''attachments'') '
         || '  and split_part(name, ''/'', 1) = auth.uid()::text)';
  end if;
end
$outer$;

-- ── global rate limiter (Gemini extraction, shared across all owners) ────
create table if not exists public.rate_limiters (
  key text primary key,
  next_available_at timestamptz not null default now()
);

-- No policies: nobody queries this table directly. All access goes through
-- claim_rate_limit_slot(), a SECURITY DEFINER function that bypasses RLS.
alter table public.rate_limiters enable row level security;

insert into public.rate_limiters (key, next_available_at)
values ('gemini_extract', now())
on conflict (key) do nothing;

create or replace function public.claim_rate_limit_slot(p_key text, p_spacing_ms int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wait_until timestamptz;
begin
  insert into public.rate_limiters (key, next_available_at)
  values (p_key, now())
  on conflict (key) do update set next_available_at = rate_limiters.next_available_at
  returning greatest(now(), rate_limiters.next_available_at) into v_wait_until;

  update public.rate_limiters
  set next_available_at = v_wait_until + make_interval(secs => p_spacing_ms / 1000.0)
  where key = p_key;

  return v_wait_until;
end;
$$;

grant execute on function public.claim_rate_limit_slot(text, int) to authenticated;
