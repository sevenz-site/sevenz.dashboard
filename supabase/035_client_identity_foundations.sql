-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Fase 1 of the client-login plan: schema groundwork only. Nothing here is
-- reachable by a client yet — no OTP, no login, no new read path. It exists
-- so the verification work in later phases doesn't have to retrofit schema
-- changes onto live data.

-- ── 1. clients.document_country ────────────────────────────────────────
-- A Colombian cédula and a Venezuelan one can be the same digits and belong
-- to two different people — this app's users are in the CO/VE border region,
-- so that collision is realistic, not theoretical. Matching a future
-- verified identity on document_id alone would silently merge two
-- strangers' balances; the real key is (country, document).
--
-- Nullable rather than not-null: the backfill below covers every existing
-- row, but leaving it nullable means a future insert that forgets it fails
-- visibly on the app side rather than being silently rejected by Postgres
-- mid-transaction.
alter table public.clients add column if not exists document_country text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_document_country_check'
  ) then
    alter table public.clients
      add constraint clients_document_country_check
      check (document_country is null or document_country in ('CO', 'VE'));
  end if;
end;
$$;

-- Inherits the owner's own country, which is right for the overwhelming
-- majority of clients. The owner can correct it per client from "Editar
-- cliente" for the cross-border cases.
update public.clients c
set document_country = o.country
from public.owners o
where c.owner_id = o.id and c.document_country is null;

-- ── 2. client_identities ───────────────────────────────────────────────
-- The anchor a future verified client session attaches to: "this auth user
-- is the person holding this (country, document), and this phone number was
-- confirmed by OTP at this time."
--
-- normalized_document_id stores the already-normalized form (same rule as
-- normalizeDocumentId in lib/format.ts — punctuation stripped, lowercased)
-- because this column exists purely to be matched on. clients.document_id
-- deliberately stays raw/as-typed, since that one is for display.
--
-- RLS is enabled with NO policies at all, on purpose: nothing — not even an
-- owner's own authenticated session — can read or write this table yet. The
-- gated access path arrives with the OTP flow in Fase 2/3 as a SECURITY
-- DEFINER function, matching how resolve_shared_client() and
-- get_shared_client_profile() already work in this schema.
create table if not exists public.client_identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  document_country text not null check (document_country in ('CO', 'VE')),
  normalized_document_id text not null,
  whatsapp text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (document_country, normalized_document_id)
);

alter table public.client_identities enable row level security;

-- ── 3. handle_new_user() guard ─────────────────────────────────────────
-- Unchanged from the original except for the email guard at the top.
--
-- This trigger fires on EVERY insert into auth.users and unconditionally
-- creates an owners row. That's correct today (only owners can sign up),
-- but once clients can sign up by phone in Fase 2, it breaks in one of two
-- ways: either every verified client silently gets a junk "business"
-- attached to them, or — if the phone-only signup carries no email at all —
-- owners.email's NOT NULL constraint aborts the entire signup transaction,
-- surfacing to the client as an unexplained failure.
--
-- The guard keys on email rather than a metadata flag deliberately: an
-- owner signup structurally always has one (the signup form requires it,
-- and owners.email is NOT NULL), while a phone-OTP signup structurally has
-- none. A metadata flag would depend on Fase 2 remembering to set it
-- correctly on every call site — this doesn't.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.owners (id, email, business_name, first_name, last_name, whatsapp, country)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp',
    -- Signup is the only place an owner picks their country — 'Mi negocio'
    -- renders it disabled afterward. Anything other than the two valid
    -- codes (a missing field, an admin-created user, ...) falls back to
    -- the column's own default rather than failing the whole signup.
    case
      when new.raw_user_meta_data ->> 'country' in ('CO', 'VE') then new.raw_user_meta_data ->> 'country'
      else 'CO'
    end
  );
  return new;
end;
$$;

insert into public.schema_migrations (key, description)
values ('035_client_identity_foundations', 'Adds clients.document_country, the client_identities table, and an email guard on handle_new_user()')
on conflict (key) do nothing;
