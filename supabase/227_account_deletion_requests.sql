-- 227 · ACCOUNT DELETION REQUESTS (PL-48, step 1.3)
--
-- Google Play requires that an app which lets people create an account also lets them ask
-- for it to be deleted, from inside the app and from a web page. Sevenz had neither.
--
-- Owner's decisions, in ../docs/PLAY-STORE-PLAN.md §5 and §7:
--   * 2026-11-18 (D4): deletion is REQUESTED, not executed on the spot, with a margin to
--     change one's mind, confirmed with a code.
--   * 2026-11-20: «Margen de 30 días para eliminar la cuenta». Frames approved that day.
--   * 2026-11-27: the deletion on day 30 is run by the Sevenz owner from /admin, not by a
--     job; only the WhatsApp consent (DM-5/DM-6) and a record that the account was deleted
--     are kept; the owner's Monday/Thursday WhatsApp stop during the 30 days; the
--     shopkeeper's own clients are not messaged.
--
-- WHAT THIS FILE DOES NOT DO: delete anything. It only records the request. Running the
-- deletion (and archiving the consent) is a later migration, with the /admin screen.
--
-- Re-runnable: `if not exists`, constraint dropped by name before re-adding, and every
-- function dropped by its exact signature before being created.

begin;

-- 1. A purpose for the code that confirms the request. The code is the existing six-digit
--    one from migration 193 (hashed, ten minutes, six per hour), sent to the account email.
alter table public.owner_login_codes drop constraint if exists owner_login_codes_purpose_check;
alter table public.owner_login_codes add constraint owner_login_codes_purpose_check
  check (purpose in ('login', 'enable', 'password', 'number', 'admin_email', 'delete_account'));

-- 2. The requests. NO foreign key to owners, on purpose: when the account is finally
--    deleted, the owner row goes and this row must stay, because it is the record that the
--    account existed and was deleted on request («un registro de que la cuenta se borró y
--    cuándo», owner, 2026-11-27). It holds no personal data: an id and dates.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  -- 'app' from Mi negocio, 'web' from the sevenz.site page (its link comes later).
  source text not null check (source in ('app', 'web')),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  -- Who ran the deletion: the admin's email. Null until then.
  deleted_by text
);

-- At most one open request per owner. A second confirm returns the open one instead of
-- moving its date: asking twice must never push the deletion further away silently.
create unique index if not exists account_deletion_requests_open_idx
  on public.account_deletion_requests (owner_id)
  where cancelled_at is null and deleted_at is null;

alter table public.account_deletion_requests enable row level security;
-- Reached only through the functions below: nobody reads or writes the table directly.
revoke all on table public.account_deletion_requests from public, anon, authenticated;

-- 3. Record a request. Called by the server action ONLY after the owner typed the code, with
--    the service role, so it is not granted to `authenticated`: a signed-in owner must not be
--    able to skip the code by calling it.
drop function if exists public.request_account_deletion(uuid, text, integer);
create function public.request_account_deletion(p_owner_id uuid, p_source text, p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.account_deletion_requests;
begin
  if p_owner_id is null or p_source not in ('app', 'web') then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  if not exists (select 1 from public.owners where id = p_owner_id) then
    return jsonb_build_object('ok', false, 'code', 'no_owner');
  end if;

  select * into v_row
    from public.account_deletion_requests
   where owner_id = p_owner_id and cancelled_at is null and deleted_at is null;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'scheduled_for', v_row.scheduled_for);
  end if;

  insert into public.account_deletion_requests (owner_id, source, scheduled_for)
  values (p_owner_id, p_source, now() + make_interval(days => greatest(1, coalesce(p_days, 30))))
  returning * into v_row;
  return jsonb_build_object('ok', true, 'already', false, 'scheduled_for', v_row.scheduled_for);
end;
$fn$;
revoke all on function public.request_account_deletion(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid, text, integer) to service_role;

-- 4. The owner's own open request, if any: the date it will run. For Mi negocio and Inicio.
drop function if exists public.my_account_deletion();
create function public.my_account_deletion()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $fn$
  select scheduled_for
    from public.account_deletion_requests
   where owner_id = auth.uid() and cancelled_at is null and deleted_at is null
   limit 1;
$fn$;
revoke all on function public.my_account_deletion() from public, anon;
grant execute on function public.my_account_deletion() to authenticated;

-- 5. Cancel it. No code: cancelling deletes nothing, and an owner who changed their mind
--    must not be stopped by a code that did not arrive. Returns whether there was one.
drop function if exists public.cancel_my_account_deletion();
create function public.cancel_my_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count int;
begin
  update public.account_deletion_requests
     set cancelled_at = now()
   where owner_id = auth.uid() and cancelled_at is null and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$fn$;
revoke all on function public.cancel_my_account_deletion() from public, anon;
grant execute on function public.cancel_my_account_deletion() to authenticated;

-- 6. Owners with an open request, for the WhatsApp senders that skip them (the Monday and
--    Thursday messages, the inactivity nudges, the trial-ending notice). Service role only.
drop function if exists public.owners_pending_deletion();
create function public.owners_pending_deletion()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select owner_id
    from public.account_deletion_requests
   where cancelled_at is null and deleted_at is null;
$fn$;
revoke all on function public.owners_pending_deletion() from public, anon, authenticated;
grant execute on function public.owners_pending_deletion() to service_role;

insert into public.schema_migrations (key, description)
values ('227_account_deletion_requests', 'Pedidos de eliminar la cuenta (PL-48, 1.3): tabla sin FK al dueño, código delete_account, 30 días, y funciones para pedir, leer, cancelar y saltar los envíos')
on conflict (key) do nothing;

commit;
