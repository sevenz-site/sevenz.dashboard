-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with
-- its own green light, and BEFORE the code (CLAUDE.md, deploy step 1). Today's production
-- code calls none of this; the current sign-in keeps working against it.
-- Re-runnable: `if not exists` on tables and columns, drop + create on every function.
--
-- ===========================================================================
-- 193: THE SECOND FACTOR — A CODE BY WHATSAPP, EMAIL AS THE FALLBACK (C1 of PL-22)
--
-- Owner's decisions of 2026-11-05. Optional per shopkeeper. The code is asked for:
--   * at sign-in, only from a device WITHOUT the `sz_device` cookie (C2's «known by
--     place» does NOT count here: a thief in the same city with the same kind of phone
--     must not skip it);
--   * to change the password from inside the app.
-- Changing the WhatsApp number and the email ask for the PASSWORD, and the new number is
-- proved with a test code before it is saved. His words: *«ladrón que entra con la puerta
-- abierta y quiere cambiar el teléfono debe tener la contraseña y al no tenerla cubrimos
-- ese caso»*.
--
-- WHAT A CODE IS. Six digits, ten minutes, five attempts, one live code per owner and
-- purpose: creating a new one invalidates the previous. Stored as sha256(code || owner id):
-- the digits never reach the database. The `ticket` is a second secret the browser keeps
-- in a short cookie while the owner is between «we sent it» and «I typed it», so a forged
-- cookie naming another owner cannot even reach the attempts counter.
--
-- WHY SUPABASE'S OWN MFA IS NOT USED. It ships TOTP (an authenticator app — the owner said
-- no) and phone through Twilio (a second WhatsApp provider beside Kapso, discarded). So the
-- codes are ours; Kapso delivers them with Meta's authentication template, Resend by email.
--
-- NOTHING HERE IS GRANTED TO A SESSION except `my_second_factor()`, which answers one
-- question about the caller's own account. Everything else is the server (service_role).
-- ===========================================================================

begin;

-- ── 1. The switch, on the row only the server writes (192) ──────────────────

alter table public.owner_security_state
  add column if not exists second_factor_enabled boolean not null default false,
  add column if not exists second_factor_enabled_at timestamptz,
  add column if not exists second_factor_disabled_at timestamptz;

-- ── 2. The codes ────────────────────────────────────────────────────────────

create table if not exists public.owner_login_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- login: sign-in from an unknown device · enable: the test code that turns the factor
  -- on · password: change it from inside the app · number: prove a new WhatsApp number ·
  -- admin_email: the check /admin runs before changing an owner's email.
  purpose text not null check (purpose in ('login', 'enable', 'password', 'number', 'admin_email')),
  channel text not null check (channel in ('whatsapp', 'email')),
  -- Where it went: the number or the address, as sent. Read back only to mask it on screen.
  target text not null,
  code_hash text not null,
  ticket_hash text,
  expires_at timestamptz not null,
  attempts int not null default 0,
  -- Set when Kapso or Resend accepted it. A code that never left cannot be typed, and it
  -- must not have killed the previous one: with it, a failed resend leaves the owner
  -- holding a code that still works. Found on the first browser walk, 2026-11-05.
  delivered_at timestamptz,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.owner_login_codes add column if not exists delivered_at timestamptz;
create index if not exists owner_login_codes_owner_idx on public.owner_login_codes (owner_id, purpose, created_at desc);

-- Who changed what about an account's access: the admin's email change, a resent recovery
-- mail, the factor turning on or off, a number change. The row that answers «who did this
-- and when» the day an owner says it was not them.
create table if not exists public.owner_security_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  action text not null,
  -- Who did it: the owner («owner») or an admin's email.
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owner_security_audit_owner_idx on public.owner_security_audit (owner_id, created_at desc);

alter table public.owner_login_codes enable row level security;
alter table public.owner_security_audit enable row level security;
revoke all on table public.owner_login_codes from public, anon, authenticated;
revoke all on table public.owner_security_audit from public, anon, authenticated;

-- ── 3. Create a code ────────────────────────────────────────────────────────
--
-- Inserts a code that is NOT yet live: `mark_login_code_delivered` makes it live once the
-- message left, and only then retires the previous one. The ceiling of 6 codes per owner,
-- purpose and hour (delivered or not) is what stops somebody with the password from
-- flooding the owner's WhatsApp, and what bounds brute force: 6 codes × 5 attempts = 30
-- guesses an hour against a million.

-- `p_prev_ticket_hash`: a RESEND must prove it continues the chain the password opened.
-- Without it, a forged cookie naming another owner could ask for a fresh code, receive a
-- fresh ticket, and start guessing without ever having typed the password. With it, the
-- previous code of that purpose (live or expired, within the hour) must carry that ticket.

drop function if exists public.create_login_code(uuid, text, text, text, text, text, integer);
drop function if exists public.create_login_code(uuid, text, text, text, text, text, integer, text);
create function public.create_login_code(
  p_owner_id uuid,
  p_purpose text,
  p_channel text,
  p_target text,
  p_code_hash text,
  p_ticket_hash text,
  p_ttl_minutes integer,
  p_prev_ticket_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_recent int;
  v_id uuid;
begin
  if p_owner_id is null or p_code_hash is null or length(p_code_hash) < 32 or coalesce(p_target, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;

  if p_prev_ticket_hash is not null and not exists (
    select 1 from public.owner_login_codes
     where owner_id = p_owner_id and purpose = p_purpose
       and ticket_hash = p_prev_ticket_hash and created_at > now() - interval '1 hour'
  ) then
    return jsonb_build_object('ok', false, 'code', 'bad_ticket');
  end if;

  select count(*)::int into v_recent
    from public.owner_login_codes
   where owner_id = p_owner_id and purpose = p_purpose and created_at > now() - interval '1 hour';
  if v_recent >= 6 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  insert into public.owner_login_codes (owner_id, purpose, channel, target, code_hash, ticket_hash, expires_at)
  values (p_owner_id, p_purpose, p_channel, p_target, p_code_hash, p_ticket_hash,
          now() + make_interval(mins => greatest(1, least(90, coalesce(p_ttl_minutes, 10)))))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'sent_this_hour', v_recent + 1);
end;
$fn$;

-- The message left: this code is now the live one, and every other live code of the same
-- owner and purpose is retired.
drop function if exists public.mark_login_code_delivered(uuid);
create function public.mark_login_code_delivered(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.owner_login_codes%rowtype;
begin
  select * into v from public.owner_login_codes where id = p_id for update;
  if not found or v.used_at is not null or v.invalidated_at is not null then
    return false;
  end if;
  update public.owner_login_codes
     set invalidated_at = now()
   where owner_id = v.owner_id and purpose = v.purpose and id <> v.id
     and used_at is null and invalidated_at is null;
  update public.owner_login_codes set delivered_at = now() where id = v.id;
  return true;
end;
$fn$;

-- ── 4. Verify a code ────────────────────────────────────────────────────────
--
-- One statement path, row locked: two simultaneous guesses cannot both see «4 attempts».
-- Codes: ok · none (nothing live) · expired · locked (fifth miss invalidates it) ·
-- mismatch (with attempts_left) · bad_ticket (the cookie names another code).

drop function if exists public.verify_login_code(uuid, text, text, text);
create function public.verify_login_code(
  p_owner_id uuid,
  p_purpose text,
  p_code_hash text,
  p_ticket_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v public.owner_login_codes%rowtype;
begin
  select * into v
    from public.owner_login_codes
   where owner_id = p_owner_id and purpose = p_purpose
     and delivered_at is not null and used_at is null and invalidated_at is null
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'none');
  end if;
  if v.ticket_hash is not null and v.ticket_hash is distinct from p_ticket_hash then
    return jsonb_build_object('ok', false, 'code', 'bad_ticket');
  end if;
  if v.expires_at <= now() then
    update public.owner_login_codes set invalidated_at = now() where id = v.id;
    return jsonb_build_object('ok', false, 'code', 'expired', 'channel', v.channel, 'target', v.target);
  end if;

  update public.owner_login_codes set attempts = attempts + 1 where id = v.id returning attempts into v.attempts;

  if v.code_hash = p_code_hash then
    update public.owner_login_codes set used_at = now() where id = v.id;
    return jsonb_build_object('ok', true, 'id', v.id, 'channel', v.channel, 'target', v.target);
  end if;

  if v.attempts >= 5 then
    update public.owner_login_codes set invalidated_at = now() where id = v.id;
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;
  return jsonb_build_object('ok', false, 'code', 'mismatch', 'attempts_left', 5 - v.attempts);
end;
$fn$;

-- A code VERIFIED in the last N minutes for this owner and purpose. What the admin's
-- «Cambiar correo» checks before writing: the verification and the change are two
-- requests, and the second must not trust the first's screen.
drop function if exists public.login_code_recently_verified(uuid, text, integer);
create function public.login_code_recently_verified(p_owner_id uuid, p_purpose text, p_minutes integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.owner_login_codes
     where owner_id = p_owner_id and purpose = p_purpose
       and used_at is not null and used_at > now() - make_interval(mins => greatest(1, p_minutes)));
$fn$;

-- ── 5. The switch ───────────────────────────────────────────────────────────

drop function if exists public.set_second_factor(uuid, boolean);
create function public.set_second_factor(p_owner_id uuid, p_enabled boolean)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into public.owner_security_state (owner_id, second_factor_enabled, second_factor_enabled_at, second_factor_disabled_at)
  values (p_owner_id, p_enabled, case when p_enabled then now() end, case when p_enabled then null else now() end)
  on conflict (owner_id) do update
    set second_factor_enabled = excluded.second_factor_enabled,
        second_factor_enabled_at = case when excluded.second_factor_enabled then now() else owner_security_state.second_factor_enabled_at end,
        second_factor_disabled_at = case when excluded.second_factor_enabled then null else now() end;
$fn$;

-- The one thing a session may ask about the factor: its own switch.
drop function if exists public.my_second_factor();
create function public.my_second_factor()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select jsonb_build_object('enabled', s.second_factor_enabled, 'enabled_at', s.second_factor_enabled_at)
       from public.owner_security_state s where s.owner_id = auth.uid()),
    jsonb_build_object('enabled', false, 'enabled_at', null));
$fn$;

-- ── 6. What sign-in needs to know BEFORE issuing a session ──────────────────
--
-- By email, because at that moment there is no session: whether the account exists, has
-- the factor on, must reset its password, and whether THIS cookie is a known device. Only
-- the cookie counts (see the header). Returns `found:false` for an unknown email, and the
-- caller must answer exactly as it would for a wrong password — never a different sentence.

drop function if exists public.second_factor_gate(text, text);
create function public.second_factor_gate(p_email text, p_device_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner public.owners%rowtype;
  v_state public.owner_security_state%rowtype;
  v_known boolean := false;
begin
  select * into v_owner from public.owners where lower(email) = lower(trim(p_email)) limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into v_state from public.owner_security_state where owner_id = v_owner.id;
  if p_device_hash is not null and length(p_device_hash) >= 16 then
    select exists (select 1 from public.owner_devices where owner_id = v_owner.id and device_hash = p_device_hash) into v_known;
  end if;
  return jsonb_build_object(
    'found', true,
    'owner_id', v_owner.id,
    'email', v_owner.email,
    'whatsapp', v_owner.whatsapp,
    'owner_country', v_owner.country,
    'second_factor', coalesce(v_state.second_factor_enabled, false),
    'must_reset', coalesce(v_state.must_reset_password, false),
    'device_known', v_known
  );
end;
$fn$;

-- The same facts for an owner already signed in (the security card, the password change):
-- by id, from the server.
drop function if exists public.owner_security_facts(uuid);
create function public.owner_security_facts(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'email', o.email,
    'whatsapp', o.whatsapp,
    'owner_country', o.country,
    'second_factor', coalesce(s.second_factor_enabled, false),
    'known_devices', (select count(*) from public.owner_devices d where d.owner_id = o.id))
  from public.owners o
  left join public.owner_security_state s on s.owner_id = o.id
  where o.id = p_owner_id;
$fn$;

-- ── 7. The audit, and the admin's two actions ───────────────────────────────

drop function if exists public.log_security_audit(uuid, text, text, jsonb);
create function public.log_security_audit(p_owner_id uuid, p_action text, p_actor text, p_detail jsonb)
returns uuid
language sql
security definer
set search_path = public
as $fn$
  insert into public.owner_security_audit (owner_id, action, actor, detail)
  values (p_owner_id, p_action, coalesce(p_actor, 'owner'), coalesce(p_detail, '{}'::jsonb))
  returning id;
$fn$;

-- What the admin sees before changing an email: facts to ask about, never secrets. The
-- clients' names stay out; the last sale is a date and an amount.
drop function if exists public.admin_cuenta_seguridad(uuid);
create function public.admin_cuenta_seguridad(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'email', o.email,
    'whatsapp', o.whatsapp,
    'country', o.country,
    'business_name', o.business_name,
    'first_name', o.first_name,
    'created_at', o.created_at,
    'clients', (select count(*) from public.clients c where c.owner_id = o.id and c.deleted_at is null),
    'last_sale_at', (select max(s.created_at) from public.sales s where s.owner_id = o.id and s.deleted_at is null),
    'sales_30d', (select count(*) from public.sales s where s.owner_id = o.id and s.deleted_at is null and s.created_at > now() - interval '30 days'),
    'second_factor', coalesce(st.second_factor_enabled, false),
    'known_devices', (select count(*) from public.owner_devices d where d.owner_id = o.id),
    'last_login_city', (select d.city from public.owner_devices d where d.owner_id = o.id order by d.last_seen desc limit 1),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'actor', a.actor, 'at', a.created_at, 'detail', a.detail) order by a.created_at desc)
                       from (select * from public.owner_security_audit a where a.owner_id = o.id order by a.created_at desc limit 10) a), '[]'::jsonb))
  from public.owners o
  left join public.owner_security_state st on st.owner_id = o.id
  where o.id = p_owner_id;
$fn$;

-- The `owners.email` half of an email change. The Auth half is the Admin API, from the
-- server, and it goes FIRST: if Auth refuses, nothing here changes. Never raw SQL on
-- `auth.users` — the address also lives in `auth.identities`.
drop function if exists public.admin_set_owner_email(uuid, text, text);
create function public.admin_set_owner_email(p_owner_id uuid, p_email text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old text;
begin
  select email into v_old from public.owners where id = p_owner_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.owners where lower(email) = lower(p_email) and id <> p_owner_id) then
    return jsonb_build_object('ok', false, 'code', 'taken');
  end if;
  update public.owners set email = lower(trim(p_email)) where id = p_owner_id;
  insert into public.owner_security_audit (owner_id, action, actor, detail)
  values (p_owner_id, 'email_changed_by_admin', p_actor, jsonb_build_object('from', v_old, 'to', lower(trim(p_email))));
  return jsonb_build_object('ok', true, 'from', v_old);
end;
$fn$;

-- ── 8. Grants, all three roles by name (039, 178) ───────────────────────────

revoke execute on function public.create_login_code(uuid, text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.mark_login_code_delivered(uuid) from public, anon, authenticated;
revoke execute on function public.verify_login_code(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.login_code_recently_verified(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.set_second_factor(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.my_second_factor() from public, anon;
revoke execute on function public.second_factor_gate(text, text) from public, anon, authenticated;
revoke execute on function public.owner_security_facts(uuid) from public, anon, authenticated;
revoke execute on function public.log_security_audit(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_cuenta_seguridad(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_owner_email(uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_login_code(uuid, text, text, text, text, text, integer, text) to service_role;
grant execute on function public.mark_login_code_delivered(uuid) to service_role;
grant execute on function public.verify_login_code(uuid, text, text, text) to service_role;
grant execute on function public.login_code_recently_verified(uuid, text, integer) to service_role;
grant execute on function public.set_second_factor(uuid, boolean) to service_role;
grant execute on function public.my_second_factor() to authenticated, service_role;
grant execute on function public.second_factor_gate(text, text) to service_role;
grant execute on function public.owner_security_facts(uuid) to service_role;
grant execute on function public.log_security_audit(uuid, text, text, jsonb) to service_role;
grant execute on function public.admin_cuenta_seguridad(uuid) to service_role;
grant execute on function public.admin_set_owner_email(uuid, text, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '193_second_factor_codes',
  'C1 de PL-22: el segundo factor opcional por código (WhatsApp, correo de respaldo), sus códigos de un solo uso, el interruptor por cuenta, la auditoría de seguridad y las dos acciones del admin (reenviar recuperación, cambiar correo). Solo el servidor escribe.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ──────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('owner_login_codes','owner_security_audit');                      -- t, t
--   select has_table_privilege('authenticated', 'public.owner_login_codes', 'select');   -- false
--   select has_function_privilege('authenticated', 'public.my_second_factor()', 'execute'); -- true
--   select has_function_privilege('authenticated',
--     'public.verify_login_code(uuid, text, text, text)', 'execute');                     -- false
