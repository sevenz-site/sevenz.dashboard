-- 229 · RUNNING AN ACCOUNT DELETION (PL-48, step 1.3)
--
-- Migration 227 records requests; this one runs them, from /admin («Borrar ahora»).
--
-- WHAT GOES AND WHAT STAYS — owner's decisions of 2026-11-27 and 2026-11-28:
--   * «la cuenta en el superadmin no debe borrarse, debe mantenerse para trazar el historial»
--   * payments: «Guardar todo, comprobantes incluidos»
--   * confirmed as a whole on 2026-11-28 («Sí, así»): the shopkeeper's access, clients,
--     movements, sales, products, catalogue, orders, photos, files and devices are deleted;
--     the ACCOUNT RECORD stays in /admin, marked «Eliminada el …»: owners row (business,
--     email, phone, country, dates, WhatsApp consent), subscriptions and payments with their
--     receipts, KAM assignment and commissions, feedback, commercial events, security log.
--
-- THE DEFAULT IS «DELETE», AND THAT IS THE POINT OF THE DESIGN. The purge does not hold a
-- list of tables to delete; it holds the short list of tables to KEEP (`v_keep`) and deletes
-- every other table that references `public.owners`, found from pg_constraint at run time.
-- A table added next month is purged without anybody remembering to add it here. Keeping
-- something new is the decision that has to be written down, never forgetting to delete it.
--
-- THE ACCESS is closed in the server action, not here (the Auth admin API), BEFORE this runs:
-- banned and its email swapped for an unusable one, so the real email is free to sign up again
-- as a new, empty business (owners.email is not unique). The auth user is not deleted because
-- owners.id references it ON DELETE CASCADE, and deleting it would take the account record.
-- This function closes every session too (auth.sessions), as «No fui yo» does in 192.
--
-- Files in Storage are deleted by the server action through the Storage API (deleting rows of
-- storage.objects leaves the files behind). This function hands back the one set of paths that
-- the owner prefix does not catch: client photos uploaded by clients themselves before 041.
--
-- Re-runnable: `if not exists` and every function dropped by its exact signature first.

begin;

-- 1. The mark /admin shows: «Eliminada el …». Null for every live account.
alter table public.owners add column if not exists account_deleted_at timestamptz;

-- 2. The list for /admin/eliminaciones: every request with what the account still says about
--    itself. Service role only, like every admin read (production revokes direct SELECT on
--    customer tables from service_role, 081).
drop function if exists public.admin_account_deletions();
create function public.admin_account_deletions()
returns table (
  request_id uuid,
  owner_id uuid,
  business_name text,
  email text,
  country text,
  source text,
  requested_at timestamptz,
  scheduled_for timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  deleted_by text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select r.id, r.owner_id, o.business_name, o.email, o.country::text, r.source,
         r.requested_at, r.scheduled_for, r.cancelled_at, r.deleted_at, r.deleted_by
    from public.account_deletion_requests r
    left join public.owners o on o.id = r.owner_id
   order by (r.cancelled_at is null and r.deleted_at is null) desc, r.scheduled_for asc;
$fn$;
revoke all on function public.admin_account_deletions() from public, anon, authenticated;
grant execute on function public.admin_account_deletions() to service_role;

-- 3. What the action needs to know before it touches anything: whether the request is open
--    and due, the business name the admin must type, and the legacy photo paths.
drop function if exists public.admin_account_deletion_check(uuid);
create function public.admin_account_deletion_check(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_req public.account_deletion_requests;
  v_name text;
  v_paths text[];
begin
  select * into v_req from public.account_deletion_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if v_req.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_deleted');
  end if;
  if v_req.scheduled_for > now() then
    return jsonb_build_object('ok', false, 'code', 'not_due', 'scheduled_for', v_req.scheduled_for);
  end if;
  select business_name into v_name from public.owners where id = v_req.owner_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_owner');
  end if;
  -- Client photos that a client uploaded himself between 032 and 041 live under the CLIENT
  -- id, outside the owner's folder. Read here, while the clients still exist.
  select coalesce(array_agg(c.profile_picture_path), '{}')
    into v_paths
    from public.clients c
   where c.owner_id = v_req.owner_id
     and c.profile_picture_path is not null
     and c.profile_picture_path not like v_req.owner_id::text || '/%';
  return jsonb_build_object('ok', true, 'owner_id', v_req.owner_id, 'business_name', v_name, 'legacy_paths', to_jsonb(v_paths));
end;
$fn$;
revoke all on function public.admin_account_deletion_check(uuid) from public, anon, authenticated;
grant execute on function public.admin_account_deletion_check(uuid) to service_role;

-- 4. The purge. Checks the request again (it may have been cancelled in between), deletes
--    every owner-referencing table outside `v_keep`, the rejections that point at auth.users,
--    every session, and marks the account and the request. One transaction: all or nothing.
drop function if exists public.admin_purge_account(uuid, text);
create function public.admin_purge_account(p_request_id uuid, p_admin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- THE TABLES THAT STAY. Everything else that references owners is deleted.
  v_keep text[] := array[
    'owners',                     -- the account record itself
    'subscriptions',              -- its plan
    'subscription_events',        -- its payments, with the receipt paths (bucket comprobantes)
    'account_kam_assignments',    -- its KAM
    'kam_commissions',            -- commissions; kam_commission_payments hangs from these
    'account_feedback',           -- what the account told Sevenz
    'account_commercial_events',  -- the commercial history
    'owner_security_audit'        -- the security log, this deletion included
  ];
  v_req public.account_deletion_requests;
  v_owner uuid;
  v_table text;
  v_column text;
  v_count bigint;
  v_deleted jsonb := '{}'::jsonb;
begin
  select * into v_req from public.account_deletion_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_req.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'code', 'cancelled');
  end if;
  if v_req.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_deleted');
  end if;
  if v_req.scheduled_for > now() then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  v_owner := v_req.owner_id;

  -- Every foreign key that points at owners(id), with the referencing column. Composite keys
  -- that include owner_id are covered too: the column found is the one matching owners.id.
  for v_table, v_column in
    select distinct c.conrelid::regclass::text, a.attname::text
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = any (c.confkey)
     where c.contype = 'f'
       and c.confrelid = 'public.owners'::regclass
       and fa.attname = 'id'
       and array_position(c.confkey, fa.attnum) = array_position(c.conkey, a.attnum)
  loop
    if replace(v_table, 'public.', '') = any (v_keep) then
      continue;
    end if;
    execute format('delete from %s where %I = $1', v_table, v_column) using v_owner;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_deleted := v_deleted || jsonb_build_object(replace(v_table, 'public.', ''), v_count);
    end if;
  end loop;

  -- `movement_rejections` points at auth.users, not owners (050), so the loop does not see it.
  if to_regclass('public.movement_rejections') is not null then
    delete from public.movement_rejections where owner_id = v_owner;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_deleted := v_deleted || jsonb_build_object('movement_rejections', v_count);
    end if;
  end if;

  -- Every session, on every device: the access is already banned, this ends what was open.
  delete from auth.sessions where user_id = v_owner;

  update public.owners set account_deleted_at = now() where id = v_owner;
  update public.account_deletion_requests
     set deleted_at = now(), deleted_by = p_admin
   where id = p_request_id;
  insert into public.owner_security_audit (owner_id, action, actor, detail)
  values (v_owner, 'account_deleted', coalesce(p_admin, 'admin'), jsonb_build_object('request_id', p_request_id, 'deleted', v_deleted));

  return jsonb_build_object('ok', true, 'owner_id', v_owner, 'deleted', v_deleted);
end;
$fn$;
revoke all on function public.admin_purge_account(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_purge_account(uuid, text) to service_role;

-- 5. For qa:eliminar-cuenta: rows that still reference the owner in a table OUTSIDE the keep
--    list. Empty after a purge. Same discovery as the purge, so a table the purge would miss is
--    exactly what this reports.
drop function if exists public.admin_account_leftovers(uuid);
create function public.admin_account_leftovers(p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_keep text[] := array['owners', 'subscriptions', 'subscription_events', 'account_kam_assignments',
                         'kam_commissions', 'account_feedback', 'account_commercial_events', 'owner_security_audit'];
  v_table text;
  v_column text;
  v_count bigint;
  v_left jsonb := '{}'::jsonb;
begin
  for v_table, v_column in
    select distinct c.conrelid::regclass::text, a.attname::text
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = any (c.confkey)
     where c.contype = 'f'
       and c.confrelid = 'public.owners'::regclass
       and fa.attname = 'id'
       and array_position(c.confkey, fa.attnum) = array_position(c.conkey, a.attnum)
  loop
    if replace(v_table, 'public.', '') = any (v_keep) then
      continue;
    end if;
    execute format('select count(*) from %s where %I = $1', v_table, v_column) into v_count using p_owner_id;
    if v_count > 0 then
      v_left := v_left || jsonb_build_object(replace(v_table, 'public.', ''), v_count);
    end if;
  end loop;
  return v_left;
end;
$fn$;
revoke all on function public.admin_account_leftovers(uuid) from public, anon, authenticated;
grant execute on function public.admin_account_leftovers(uuid) to service_role;

insert into public.schema_migrations (key, description)
values ('229_account_deletion_purge', 'Ejecutar la eliminación de una cuenta desde /admin (PL-48, 1.3): se borra todo lo que cuelga del dueño salvo la ficha, el plan y los pagos, el KAM, comentarios, eventos y el registro de seguridad; marca account_deleted_at')
on conflict (key) do nothing;

commit;
