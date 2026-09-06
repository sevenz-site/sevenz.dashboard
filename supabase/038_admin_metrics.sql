-- Run once in the SQL editor, BOTH the dev branch and production — same
-- dual-environment discipline as every migration before it.
--
-- Aggregates for the superadmin dashboard at /admin.
--
-- These deliberately return already-aggregated rows rather than letting the app
-- fetch movements and sum them in Node. Two reasons, both learned the hard way
-- in this codebase: PostgREST caps a plain select at 1,000 rows and truncates
-- silently — which is exactly what made the Cartera chart draw 10 of a week's
-- 131 movements — and a platform-wide query has no natural row ceiling at all,
-- so the amount of data pulled into memory would grow with the business.
--
-- SECURITY DEFINER, and granted to service_role ONLY. Never to authenticated:
-- these cross every owner's RLS boundary by design, so an owner session must
-- not be able to call them even if the route that uses them ever leaked. The
-- gate that decides who may see this data lives in the app
-- (lib/admin/guard.ts), not in the database.
--
-- Every function takes the same five filters, with NULL meaning "no filter":
--   p_country   'CO' | 'VE'
--   p_currency  'COP' | 'USD' | 'EUR'   (a CO ledger stores currency = NULL)
--   p_owner     owners.id
--   p_from      inclusive lower bound on created_at
--   p_to        exclusive upper bound
--
-- Deleted movements are excluded everywhere. A restored one counts again, with
-- no reconciliation needed — which is why this reads the ledger rather than an
-- event stream.
begin;

-- ── 1. Money, one row per currency ──────────────────────────────────────
-- Amounts are grouped per currency and never summed across them: $50 and €20
-- are two independent debts, not one figure seen two ways.
create or replace function public.admin_metrics_summary(
  p_country  text default null,
  p_currency text default null,
  p_owner    uuid default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  currency          text,
  movements_total   bigint,
  charges_count     bigint,
  charge_total      numeric,
  charge_average    numeric,
  payments_count    bigint,
  payment_total     numeric,
  payment_average   numeric,
  plazo_average     numeric,
  charges_with_plazo bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(m.currency, 'COP')                                        as currency,
    count(*)                                                           as movements_total,
    count(*) filter (where m.type = 'charge')                          as charges_count,
    round(coalesce(sum(m.amount) filter (where m.type = 'charge'), 0), 2)  as charge_total,
    round(avg(m.amount) filter (where m.type = 'charge'), 2)               as charge_average,
    count(*) filter (where m.type = 'payment')                         as payments_count,
    round(coalesce(sum(m.amount) filter (where m.type = 'payment'), 0), 2) as payment_total,
    round(avg(m.amount) filter (where m.type = 'payment'), 2)              as payment_average,
    -- Only charges carry a plazo and it is optional ("Sin especificar"), so
    -- the average is over the charges that actually set one.
    round(avg(m.plazo_dias) filter (where m.type = 'charge' and m.plazo_dias is not null), 1) as plazo_average,
    count(*) filter (where m.type = 'charge' and m.plazo_dias is not null) as charges_with_plazo
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    and (p_country  is null or o.country = p_country)
    and (p_currency is null or coalesce(m.currency, 'COP') = p_currency)
    and (p_owner    is null or o.id = p_owner)
    and (p_from     is null or m.created_at >= p_from)
    and (p_to       is null or m.created_at <  p_to)
  group by coalesce(m.currency, 'COP')
  order by 1;
$$;

-- ── 2. Clients and mala paga ────────────────────────────────────────────
-- Labelled/unlabelled come from client_flags history rather than the
-- is_flagged boolean. The boolean only answers "right now"; the history is
-- what makes "how many were marked last month" answerable at all.
create or replace function public.admin_metrics_totals(
  p_country text default null,
  p_owner   uuid default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns table (
  clients_created      bigint,
  clients_flagged_now  bigint,
  mala_paga_labelled   bigint,
  mala_paga_unlabelled bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.clients c
       join public.owners o on o.id = c.owner_id
      where (p_country is null or o.country = p_country)
        and (p_owner   is null or o.id = p_owner)
        and (p_from    is null or c.created_at >= p_from)
        and (p_to      is null or c.created_at <  p_to)),
    (select count(*) from public.clients c
       join public.owners o on o.id = c.owner_id
      where c.is_flagged
        and (p_country is null or o.country = p_country)
        and (p_owner   is null or o.id = p_owner)),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where (p_country is null or o.country = p_country)
        and (p_owner   is null or o.id = p_owner)
        and (p_from    is null or f.flagged_at >= p_from)
        and (p_to      is null or f.flagged_at <  p_to)),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where f.unflagged_at is not null
        and (p_country is null or o.country = p_country)
        and (p_owner   is null or o.id = p_owner)
        and (p_from    is null or f.unflagged_at >= p_from)
        and (p_to      is null or f.unflagged_at <  p_to));
$$;

-- ── 3. Trend over time ──────────────────────────────────────────────────
-- p_bucket is passed to date_trunc, so 'day' | 'week' | 'month'. Validated
-- against a fixed list rather than interpolated, since date_trunc takes text
-- and this function is SECURITY DEFINER.
create or replace function public.admin_metrics_timeseries(
  p_bucket   text default 'week',
  p_country  text default null,
  p_currency text default null,
  p_owner    uuid default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  bucket          timestamptz,
  movements       bigint,
  charges         bigint,
  payments        bigint,
  charge_total    numeric,
  payment_total   numeric,
  clients_created bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text;
begin
  v_bucket := case when p_bucket in ('day', 'week', 'month') then p_bucket else 'week' end;

  return query
  with movement_buckets as (
    select
      date_trunc(v_bucket, m.created_at) as bucket,
      count(*)                                                                as movements,
      count(*) filter (where m.type = 'charge')                               as charges,
      count(*) filter (where m.type = 'payment')                              as payments,
      round(coalesce(sum(m.amount) filter (where m.type = 'charge'), 0), 2)   as charge_total,
      round(coalesce(sum(m.amount) filter (where m.type = 'payment'), 0), 2)  as payment_total
    from public.movements m
    join public.clients c on c.id = m.client_id
    join public.owners  o on o.id = c.owner_id
    where m.deleted_at is null
      and (p_country  is null or o.country = p_country)
      and (p_currency is null or coalesce(m.currency, 'COP') = p_currency)
      and (p_owner    is null or o.id = p_owner)
      and (p_from     is null or m.created_at >= p_from)
      and (p_to       is null or m.created_at <  p_to)
    group by 1
  ),
  client_buckets as (
    select date_trunc(v_bucket, c.created_at) as bucket, count(*) as clients_created
    from public.clients c
    join public.owners o on o.id = c.owner_id
    where (p_country is null or o.country = p_country)
      and (p_owner   is null or o.id = p_owner)
      and (p_from    is null or c.created_at >= p_from)
      and (p_to      is null or c.created_at <  p_to)
    group by 1
  )
  -- Full join so a period with clients but no movements (or the reverse) still
  -- produces a point, instead of silently vanishing from the trend line.
  select
    coalesce(mb.bucket, cb.bucket)        as bucket,
    coalesce(mb.movements, 0)             as movements,
    coalesce(mb.charges, 0)               as charges,
    coalesce(mb.payments, 0)              as payments,
    coalesce(mb.charge_total, 0)          as charge_total,
    coalesce(mb.payment_total, 0)         as payment_total,
    coalesce(cb.clients_created, 0)       as clients_created
  from movement_buckets mb
  full join client_buckets cb on cb.bucket = mb.bucket
  order by 1;
end;
$$;

-- ── 4. Per owner ────────────────────────────────────────────────────────
create or replace function public.admin_metrics_by_owner(
  p_country  text default null,
  p_currency text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  owner_id      uuid,
  business_name text,
  country       text,
  clients       bigint,
  movements     bigint,
  charge_total  numeric,
  payment_total numeric,
  last_activity timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    o.business_name,
    o.country,
    count(distinct c.id)                                                   as clients,
    count(m.id)                                                            as movements,
    round(coalesce(sum(m.amount) filter (where m.type = 'charge'), 0), 2)  as charge_total,
    round(coalesce(sum(m.amount) filter (where m.type = 'payment'), 0), 2) as payment_total,
    max(m.created_at)                                                      as last_activity
  from public.owners o
  left join public.clients c on c.owner_id = o.id
  left join public.movements m
    on m.client_id = c.id
   and m.deleted_at is null
   and (p_currency is null or coalesce(m.currency, 'COP') = p_currency)
   and (p_from     is null or m.created_at >= p_from)
   and (p_to       is null or m.created_at <  p_to)
  where (p_country is null or o.country = p_country)
  group by o.id, o.business_name, o.country
  order by movements desc, o.business_name;
$$;

-- service_role only. Revoking from public/anon/authenticated first because
-- Postgres grants EXECUTE to public by default on a new function — without
-- these revokes every one of these would be callable by any owner's session.
revoke execute on function public.admin_metrics_summary(text, text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_totals(text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_timeseries(text, text, text, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_by_owner(text, text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.admin_metrics_summary(text, text, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_totals(text, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_timeseries(text, text, text, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_by_owner(text, text, timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '038_admin_metrics',
  'Aggregate functions for the /admin superadmin dashboard: money per currency, client and mala paga totals, trend over time, and per-owner rows. service_role only.'
)
on conflict (key) do nothing;

commit;
