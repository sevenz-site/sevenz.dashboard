-- ENVIRONMENT: run in BOTH — dev branch (vzqppwrwnmlbrxizskdh) and production
-- (rabmiyqodnvnrwiartuj). Dev first, production second; nothing depends on the
-- order here because this only adds functions.
--
-- Fixes /admin failing in production with "permission denied for table owners".
--
-- The cause was a real difference between the two databases, not a bug in the
-- app. In production, SELECT/INSERT/UPDATE/DELETE were revoked from anon AND
-- service_role on public.owners — deliberate hardening, and correct. In dev
-- they were never revoked. So lib/admin/metrics.ts reading tables directly with
-- the service-role client worked in dev and could never have worked in
-- production.
--
-- The fix is NOT to grant those privileges back. That would undo the hardening
-- across every table just to let one page read four of them. Instead the reads
-- move behind SECURITY DEFINER functions, which run as the function's owner and
-- therefore need no table grants at all. The privilege surface for /admin
-- becomes a short list of named functions granted to service_role, rather than
-- blanket SELECT on customer tables.
--
-- Returning `setof jsonb` rather than a typed table on purpose: client_summary
-- is a view whose column set has changed across five migrations, and declaring
-- its shape here would be one more place to keep in sync. to_jsonb(row) returns
-- whatever the view actually has, and the caller reads fields by name.
begin;

-- ── Owners, for the filter select ───────────────────────────────────────
create or replace function public.admin_owner_options()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', o.id,
           'business_name', o.business_name,
           'country', o.country
         )
  from public.owners o
  order by o.business_name;
$$;

-- ── Per-client inputs for the credit score ──────────────────────────────
-- The score itself stays in TypeScript (lib/credit-score.ts) — this only
-- supplies what it needs. most_recent_unflagged_at is folded in here so the
-- caller no longer has to read client_flags separately.
create or replace function public.admin_credit_inputs(
  p_country text default null,
  p_owner   uuid default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(cs) || jsonb_build_object(
           'most_recent_unflagged_at',
           (select max(f.unflagged_at)
              from public.client_flags f
             where f.client_id = cs.client_id)
         )
  from public.client_summary cs
  join public.owners o on o.id = cs.owner_id
  where (p_country is null or o.country = p_country)
    and (p_owner   is null or o.id = p_owner)
    and (p_from    is null or cs.client_created_at >= p_from)
    and (p_to      is null or cs.client_created_at <  p_to);
$$;

-- ── Movements for those same clients ────────────────────────────────────
-- Scoped by the identical filters rather than by a list of ids passed in, so
-- the two functions cannot drift out of agreement about which clients are in
-- scope, and no id array has to cross the wire.
create or replace function public.admin_credit_movements(
  p_country text default null,
  p_owner   uuid default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', m.id,
           'client_id', m.client_id,
           'type', m.type,
           'amount', m.amount,
           'currency', m.currency,
           'plazo_dias', m.plazo_dias,
           'created_at', m.created_at
         )
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    and (p_country is null or o.country = p_country)
    and (p_owner   is null or o.id = p_owner)
    and (p_from    is null or c.created_at >= p_from)
    and (p_to      is null or c.created_at <  p_to)
  order by m.created_at;
$$;

-- Same posture as 038: revoke the default public EXECUTE first, then grant to
-- service_role alone. These read every owner's data by design.
revoke execute on function public.admin_owner_options() from public, anon, authenticated;
revoke execute on function public.admin_credit_inputs(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_credit_movements(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.admin_owner_options() to service_role;
grant execute on function public.admin_credit_inputs(text, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.admin_credit_movements(text, uuid, timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '039_admin_reads_without_table_grants',
  'Moves /admin''s direct table reads behind SECURITY DEFINER functions so they need no service_role table grants — production had SELECT revoked on owners, which dev had not.'
)
on conflict (key) do nothing;

commit;
