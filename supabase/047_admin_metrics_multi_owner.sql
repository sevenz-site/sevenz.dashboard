-- ENVIRONMENT: run in DEV ONLY first — dev branch (vzqppwrwnmlbrxizskdh).
-- Then, once verified, in production (rabmiyqodnvnrwiartuj) IMMEDIATELY BEFORE
-- deploying the matching code. Read the next paragraph before running either.
--
-- THIS ONE BREAKS /admin FOR A FEW MINUTES, AND THAT IS THE ACCEPTED CHOICE.
-- Six functions change their parameter list, so the code deployed today calls a
-- signature that will no longer exist. Neither order degrades gracefully:
-- migration first breaks the running page, code first breaks the new page.
-- The alternative was keeping the old signatures as wrappers — about 75 lines
-- of transitional SQL duplicating every `returns table(...)`, plus a later
-- migration to remove them.
--
-- The window was accepted because of who it touches: NOTHING owner-facing calls
-- these functions. Not the share link, not recording a movement, not the
-- calculator, not the app. They are used by /admin and by the analytics CLI,
-- both of which are one person. Verified by grepping for every caller.
-- So the worst case is that whoever opens /admin during those minutes sees an
-- error and reloads.
--
-- WHY. The "Negocio" filter took a single business. Segmenting the platform —
-- "how do these four shops compare to the rest" — was impossible without
-- running the report once per shop and adding it up by hand, which is exactly
-- the kind of manual aggregation that produces two different answers to the
-- same question.
--
-- p_owner uuid becomes p_owners uuid[] in five functions, and
-- admin_metrics_by_owner gains it: that one never had an owner filter at all,
-- so selecting a business still listed every business in the table underneath
-- the filtered figures. A filter that visibly does not filter is worse than a
-- missing one, because it teaches people to distrust the numbers above it.
--
-- An EMPTY array means "all", exactly like null. Deselecting the last business
-- in a multi-select is a person clearing the filter, not asking for the metrics
-- of no businesses; answering that with a page of zeros would look like data
-- loss.
begin;

-- Dropped rather than replaced: `create or replace` matches on name AND
-- argument types, so changing a parameter's type creates a second overload
-- instead of replacing anything. Two overloads is how PostgREST starts
-- resolving calls to whichever one it likes, which is a far worse failure than
-- a few minutes of downtime.
drop function if exists public.admin_metrics_summary(text, text, uuid, timestamptz, timestamptz);
drop function if exists public.admin_metrics_totals(text, uuid, timestamptz, timestamptz);
drop function if exists public.admin_metrics_timeseries(text, text, text, uuid, timestamptz, timestamptz);
drop function if exists public.admin_metrics_by_owner(text, text, timestamptz, timestamptz);
drop function if exists public.admin_credit_inputs(text, uuid, timestamptz, timestamptz);
drop function if exists public.admin_credit_movements(text, uuid, timestamptz, timestamptz);

-- ── 1. Money, per currency ──────────────────────────────────────────────
create function public.admin_metrics_summary(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
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
    and (p_owners   is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and (p_from     is null or m.created_at >= p_from)
    and (p_to       is null or m.created_at <  p_to)
  group by coalesce(m.currency, 'COP')
  order by 1;
$$;

-- ── 2. Clients and mala paga ────────────────────────────────────────────
-- Labelled/unlabelled come from client_flags history rather than the
-- is_flagged boolean. The boolean only answers "right now"; the history is
-- what makes "how many were marked last month" answerable at all.
create function public.admin_metrics_totals(
  p_country text default null,
  p_owners  uuid[] default null,
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
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and (p_from    is null or c.created_at >= p_from)
        and (p_to      is null or c.created_at <  p_to)),
    (select count(*) from public.clients c
       join public.owners o on o.id = c.owner_id
      where c.is_flagged
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and (p_from    is null or f.flagged_at >= p_from)
        and (p_to      is null or f.flagged_at <  p_to)),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where f.unflagged_at is not null
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and (p_from    is null or f.unflagged_at >= p_from)
        and (p_to      is null or f.unflagged_at <  p_to));
$$;

-- ── 3. Trend over time ──────────────────────────────────────────────────
-- p_bucket is passed to date_trunc, so 'day' | 'week' | 'month'. Validated
-- against a fixed list rather than interpolated, since date_trunc takes text
-- and this function is SECURITY DEFINER.
create function public.admin_metrics_timeseries(
  p_bucket   text default 'week',
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
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
      and (p_owners   is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
      and (p_from     is null or m.created_at >= p_from)
      and (p_to       is null or m.created_at <  p_to)
    group by 1
  ),
  client_buckets as (
    select date_trunc(v_bucket, c.created_at) as bucket, count(*) as clients_created
    from public.clients c
    join public.owners o on o.id = c.owner_id
    where (p_country is null or o.country = p_country)
      and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
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

-- ── 4. Per business ─────────────────────────────────────────────────────
-- Gains p_owners, which it never had. Before this, choosing a business
-- filtered every figure on the page except the table listing the businesses —
-- so the one place you would look to check the filter was the one place it did
-- not apply.
--
-- Still a LEFT JOIN from owners, so a selected business with no clients yet
-- appears with zeros rather than vanishing. The per-country summary on /admin
-- is rolled up from these rows, and a business dropping out of the list would
-- silently change that summary too.
create function public.admin_metrics_by_owner(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
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
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
  group by o.id, o.business_name, o.country
  order by movements desc, o.business_name;
$$;

-- ── 5. Per-client inputs for the credit score ───────────────────────────
create function public.admin_credit_inputs(
  p_country text default null,
  p_owners  uuid[] default null,
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
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and (p_from    is null or cs.client_created_at >= p_from)
    and (p_to      is null or cs.client_created_at <  p_to);
$$;

-- ── 6. Movements for those same clients ─────────────────────────────────
-- Scoped by the identical filters rather than by a list of ids passed in, so
-- the two functions cannot drift out of agreement about which clients are in
-- scope, and no id array has to cross the wire.
create function public.admin_credit_movements(
  p_country text default null,
  p_owners  uuid[] default null,
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
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and (p_from    is null or c.created_at >= p_from)
    and (p_to      is null or c.created_at <  p_to)
  order by m.created_at;
$$;

-- Same posture as 038 and 039: revoke the default PUBLIC execute first, then
-- grant to service_role alone. `revoke ... from anon, authenticated` without
-- `public` changes nothing, because Postgres grants EXECUTE to PUBLIC on
-- creation and both roles execute through that default — the trap 041 walked
-- into. These functions read every owner's data; an owner session must never
-- reach them.
revoke execute on function public.admin_metrics_summary(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_totals(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_timeseries(text, text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_by_owner(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_credit_inputs(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_credit_movements(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.admin_metrics_summary(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_totals(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_timeseries(text, text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_by_owner(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_credit_inputs(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_credit_movements(text, uuid[], timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '047_admin_metrics_multi_owner',
  'The six admin metric functions take p_owners uuid[] instead of a single p_owner, so /admin can segment by several businesses at once. admin_metrics_by_owner gains the filter it never had. An empty array means all, like null.'
)
on conflict (key) do nothing;

commit;
