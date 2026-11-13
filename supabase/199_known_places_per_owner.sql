-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE `NEW_DEVICE_ALERTS` is turned on (CLAUDE.md, deploy step 1).
-- The code in production today keeps working against it: the function keeps its name, its
-- arguments and every field it returns.
-- Re-runnable: `if not exists` on the table, `on conflict` on the backfill, drop + create on
-- the function.
--
-- ===========================================================================
-- 199: A DEVICE IS KNOWN BY EVERY PLACE IT SIGNED IN FROM, NOT ONLY THE LAST (PL-40)
--
-- WHAT WAS WRONG. `register_login_device` (192) recognises a device by its cookie and,
-- failing that, by «same browser, same country and city, seen in the last 90 days». That
-- place was read from `owner_devices`, one row per device, and every sign-in with the cookie
-- OVERWROTE the row's city. So the place a phone was known by was only its last one.
--
-- In plain words: María always signs in from Barquisimeto. One day her carrier places her in
-- Caracas, and the row moves to Caracas. Then Safari drops the cookie (iPhone does, after
-- days without use: the reason the fallback exists) and she signs in from Barquisimeto, as
-- always. Nothing remembers Barquisimeto, so Sevenz writes to her «alguien entró a tu
-- cuenta». It was her. A frightened shopkeeper taps «No fui yo», every session closes and
-- she has to set a new password, for nothing. And an alert that cries wolf is ignored the
-- day it matters.
--
-- Found on 2026-11-09 by `qa:security-alerts`, the first suite to run a sign-in end to end,
-- the day both security alerts were queued for v0.5.1. The alert had never been on, so no
-- shopkeeper received one. Owner's decision that day: *«Aprobado la solución a tus
-- hallazgos»*.
--
-- THE FIX. A table of places, one row per owner, browser and city, touched on every sign-in.
-- The fallback reads it instead of the devices. `owner_devices` keeps moving its city, which
-- is what `/admin/cuentas` shows as the last sign-in (193).
--
-- WHAT THIS COSTS, said out loud. The set of places that count as «known» grows: every city
-- the owner signed in from in 90 days, not just the latest per device. The cost 192 already
-- accepted («a thief in the same city with the same kind of phone raises no alert») now
-- covers each of those cities. It does not change the rule, it stops the rule from
-- forgetting.
--
-- WHAT IT DOES NOT CHANGE. A sign-in that was NOT recognised still records its place, as it
-- always did by inserting its device row: after the alert goes out, that place is known.
-- The first device ever is still recorded in silence. Places older than 90 days are deleted
-- as the owner signs in, because past that they recognise nothing and are only data kept.
--
-- NOTHING HERE IS GRANTED TO A SESSION, same as 192.
-- ===========================================================================

begin;

-- ── 1. The places ───────────────────────────────────────────────────────────

-- `country` and `city` are '' and not null when Vercel sent no header: a primary key cannot
-- hold nulls, and '' keeps what 192 did with `is not distinct from` (a sign-in with no place
-- only matches another with no place).
create table if not exists public.owner_device_places (
  owner_id uuid not null references public.owners (id) on delete cascade,
  browser text not null,
  country text not null default '',
  city text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (owner_id, browser, country, city)
);

alter table public.owner_device_places enable row level security;
revoke all on table public.owner_device_places from public, anon, authenticated;

-- What is already known: the current place of every device on record. Not a guess about the
-- past, a copy of what `owner_devices` holds today.
insert into public.owner_device_places (owner_id, browser, country, city, first_seen, last_seen)
select d.owner_id, d.browser, coalesce(d.country, ''), coalesce(d.city, ''), min(d.first_seen), max(d.last_seen)
  from public.owner_devices d
 group by d.owner_id, d.browser, coalesce(d.country, ''), coalesce(d.city, '')
on conflict (owner_id, browser, country, city) do nothing;

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
  v_browser text := coalesce(p_browser, 'otro');
  v_country text := coalesce(p_country, '');
  v_city text := coalesce(p_city, '');
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
      select 1 from public.owner_device_places p
       where p.owner_id = p_owner_id
         and p.browser = v_browser
         and p.country = v_country
         and p.city = v_city
         and p.last_seen >= now() - interval '90 days'
    ) then
      v_by := 'place';
    end if;
    insert into public.owner_devices (owner_id, device_hash, browser, country, city)
    values (p_owner_id, p_device_hash, v_browser, p_country, p_city);
  end if;

  -- AFTER the question, never before: recording the place first would make every sign-in
  -- recognise itself.
  insert into public.owner_device_places (owner_id, browser, country, city)
  values (p_owner_id, v_browser, v_country, v_city)
  on conflict (owner_id, browser, country, city) do update set last_seen = now();

  delete from public.owner_device_places
   where owner_id = p_owner_id and last_seen < now() - interval '90 days';

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

revoke execute on function public.register_login_device(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_login_device(uuid, text, text, text, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '199_known_places_per_owner',
  'PL-40: un aparato se reconoce por todas las ciudades desde las que entró en 90 días, no solo la última. Evita el aviso falso de «alguien entró a tu cuenta» cuando el teléfono pierde la cookie y vuelve a su ciudad de siempre. Tabla owner_device_places, solo del servidor.'
)
on conflict (key) do nothing;

commit;
