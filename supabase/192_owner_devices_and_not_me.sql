-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with
-- its own green light, and BEFORE the code (CLAUDE.md, deploy step 1). The code in
-- production today calls none of this; the old login keeps working against it.
-- Re-runnable: `if not exists` on the tables, drop + create on every function.
--
-- ===========================================================================
-- 192: WHICH DEVICES SIGN IN, AND «NO FUI YO» (C2 of PL-22)
--
-- Owner's decision of 2026-11-05: when someone signs in to a shopkeeper's account from a
-- device Sevenz did not know, the shopkeeper gets a WhatsApp (`new_device_login_alert`)
-- with one button, «No fui yo», that closes every session of the account and makes the
-- next sign-in require a new password. His words: *«si otro dispositivo distinto al
-- tendero inicia sesión se le manda un (…) aviso (…) y que confirme si fue él o no»*.
--
-- WHAT A KNOWN DEVICE IS. First the cookie this app sets at sign-in (`sz_device`, stored
-- hashed). Failing that, the same browser family in the same country and city seen in the
-- last 90 days. The fallback exists because iPhone wipes the cookie after days without
-- use; without it every entry from the same phone would read as new and the alert would be
-- ignored within a week. Its cost, accepted: a thief in the same city with the same kind of
-- phone raises no alert.
--
-- THE FIRST DEVICE EVER IS RECORDED SILENTLY. The day this ships every owner's next sign-in
-- is from a device Sevenz never saw; alerting all of them would be noise on day one.
--
-- NOTHING HERE IS GRANTED TO A SESSION. The tables are written and read only through the
-- functions below, by the server (service_role). `my_security_state` is the one function an
-- owner may call, and all it returns is a boolean about their own account.
--
-- «NO FUI YO» CLOSES SESSIONS BY DELETING `auth.sessions`: every refresh token of that user
-- dies with its row, so no device can renew. An access token already issued keeps working
-- against the data API until it expires (60 minutes, the session ticket of 2026-11-02);
-- screens close at once because the proxy asks Auth on every request, and Auth refuses a
-- token whose session is gone. The same window «Cerrar sesión en todos» leaves today.
-- ===========================================================================

begin;

-- ── 1. The tables ───────────────────────────────────────────────────────────

create table if not exists public.owner_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- sha256 of the cookie value. The cookie itself never reaches the database.
  device_hash text not null,
  browser text not null default 'otro',
  country text,
  city text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (owner_id, device_hash)
);
create index if not exists owner_devices_owner_seen_idx on public.owner_devices (owner_id, last_seen desc);

create table if not exists public.owner_security_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- sha256 of the suffix that travels in the WhatsApp button. One use, 24 hours.
  token_hash text not null unique,
  purpose text not null check (purpose in ('not_me')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists owner_security_tokens_owner_idx on public.owner_security_tokens (owner_id, created_at desc);

-- A row of its own and not a column on `owners`: an owner session may update its own
-- `owners` row, so a thief with the session could clear a flag kept there. Nobody but the
-- server writes this table.
create table if not exists public.owner_security_state (
  owner_id uuid primary key references public.owners (id) on delete cascade,
  must_reset_password boolean not null default false,
  reason text,
  set_at timestamptz,
  cleared_at timestamptz
);

alter table public.owner_devices enable row level security;
alter table public.owner_security_tokens enable row level security;
alter table public.owner_security_state enable row level security;

revoke all on table public.owner_devices from public, anon, authenticated;
revoke all on table public.owner_security_tokens from public, anon, authenticated;
revoke all on table public.owner_security_state from public, anon, authenticated;

-- ── 2. Sign-in: is this device known? ───────────────────────────────────────

drop function if exists public.register_login_device(uuid, text, text, text, text);
create function public.register_login_device(
  p_owner_id uuid,
  p_device_hash text,
  p_browser text,
  p_country text,
  p_city text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_known_devices int;
  v_by text := null;
  v_whatsapp text;
  v_owner_country text;
  v_email text;
begin
  if p_owner_id is null or p_device_hash is null or length(p_device_hash) < 16 then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;

  select count(*)::int into v_known_devices from public.owner_devices where owner_id = p_owner_id;

  update public.owner_devices
     set last_seen = now(),
         browser = coalesce(p_browser, browser),
         country = coalesce(p_country, country),
         city = coalesce(p_city, city)
   where owner_id = p_owner_id and device_hash = p_device_hash;
  if found then
    v_by := 'device';
  else
    if exists (
      select 1 from public.owner_devices d
       where d.owner_id = p_owner_id
         and d.browser = coalesce(p_browser, 'otro')
         and d.country is not distinct from p_country
         and d.city is not distinct from p_city
         and d.last_seen >= now() - interval '90 days'
    ) then
      v_by := 'place';
    end if;
    insert into public.owner_devices (owner_id, device_hash, browser, country, city)
    values (p_owner_id, p_device_hash, coalesce(p_browser, 'otro'), p_country, p_city);
  end if;

  select o.whatsapp, o.country, o.email into v_whatsapp, v_owner_country, v_email
    from public.owners o where o.id = p_owner_id;

  return jsonb_build_object(
    'ok', true,
    'known', v_by is not null,
    'by', v_by,
    'known_devices', v_known_devices,
    'first_ever', v_known_devices = 0,
    'whatsapp', v_whatsapp,
    'owner_country', v_owner_country,
    'email', v_email
  );
end;
$fn$;

-- ── 3. The «No fui yo» token ────────────────────────────────────────────────

drop function if exists public.create_not_me_token(uuid, text, integer);
create function public.create_not_me_token(p_owner_id uuid, p_token_hash text, p_ttl_hours integer)
returns uuid
language sql
security definer
set search_path = public
as $fn$
  insert into public.owner_security_tokens (owner_id, token_hash, purpose, expires_at)
  values (p_owner_id, p_token_hash, 'not_me', now() + make_interval(hours => greatest(1, p_ttl_hours)))
  returning id;
$fn$;

-- Read-only: what the page shows before the owner confirms. A link preview or a scanner
-- that fetches the URL must not close anything, so the GET only looks.
drop function if exists public.peek_not_me_token(text);
create function public.peek_not_me_token(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select jsonb_build_object(
       'ok', t.used_at is null and t.expires_at > now(),
       'code', case when t.used_at is not null then 'used' when t.expires_at <= now() then 'expired' else null end)
     from public.owner_security_tokens t where t.token_hash = p_token_hash and t.purpose = 'not_me'),
    jsonb_build_object('ok', false, 'code', 'invalid'));
$fn$;

drop function if exists public.consume_not_me_token(text);
create function public.consume_not_me_token(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tok public.owner_security_tokens%rowtype;
  v_email text;
begin
  select * into v_tok from public.owner_security_tokens
   where token_hash = p_token_hash and purpose = 'not_me'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if v_tok.used_at is not null then
    return jsonb_build_object('ok', false, 'code', 'used');
  end if;
  if v_tok.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  update public.owner_security_tokens set used_at = now() where id = v_tok.id;

  insert into public.owner_security_state (owner_id, must_reset_password, reason, set_at, cleared_at)
  values (v_tok.owner_id, true, 'not_me', now(), null)
  on conflict (owner_id) do update
    set must_reset_password = true, reason = 'not_me', set_at = now(), cleared_at = null;

  -- Every session of the account, on every device. See the header.
  delete from auth.sessions where user_id = v_tok.owner_id;

  select email into v_email from public.owners where id = v_tok.owner_id;

  return jsonb_build_object('ok', true, 'owner_id', v_tok.owner_id, 'email', v_email);
end;
$fn$;

-- ── 4. The flag, and who may read it ────────────────────────────────────────

drop function if exists public.clear_must_reset_password(uuid);
create function public.clear_must_reset_password(p_owner_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.owner_security_state
     set must_reset_password = false, cleared_at = now()
   where owner_id = p_owner_id;
$fn$;

-- The one thing a session may ask: «¿tengo que cambiar la contraseña?», about itself.
drop function if exists public.my_security_state();
create function public.my_security_state()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select must_reset_password from public.owner_security_state where owner_id = auth.uid()),
    false);
$fn$;

-- ── 5. Grants, all three roles by name (039, 178) ───────────────────────────

revoke execute on function public.register_login_device(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_not_me_token(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.peek_not_me_token(text) from public, anon, authenticated;
revoke execute on function public.consume_not_me_token(text) from public, anon, authenticated;
revoke execute on function public.clear_must_reset_password(uuid) from public, anon, authenticated;
revoke execute on function public.my_security_state() from public, anon;

grant execute on function public.register_login_device(uuid, text, text, text, text) to service_role;
grant execute on function public.create_not_me_token(uuid, text, integer) to service_role;
grant execute on function public.peek_not_me_token(text) to service_role;
grant execute on function public.consume_not_me_token(text) to service_role;
grant execute on function public.clear_must_reset_password(uuid) to service_role;
grant execute on function public.my_security_state() to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '192_owner_devices_and_not_me',
  'C2 de PL-22: aparatos conocidos por dueño, el token de «No fui yo» y la marca de cambiar contraseña. Solo el servidor escribe; una sesión solo puede preguntar por su propia marca.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ──────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('owner_devices','owner_security_tokens','owner_security_state');  -- t, t, t
--   select has_table_privilege('authenticated', 'public.owner_devices', 'select');       -- false
--   select has_function_privilege('authenticated', 'public.my_security_state()', 'execute'); -- true
--   select has_function_privilege('authenticated',
--     'public.consume_not_me_token(text)', 'execute');                                    -- false
