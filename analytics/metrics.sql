-- Sevenz product metrics — read-only. Paste into the Supabase SQL editor.
--
-- Source of truth is the database, not Mixpanel: every figure here covers the
-- full history since launch, is exact rather than sampled, and does not depend
-- on an owner's browser being willing to send an event. That last point is why
-- these live here — iOS Safari drops analytics requests, so anything measured
-- from the device under-reports by an unknown amount.
--
-- Deleted movements are excluded everywhere (deleted_at is null). A deleted
-- movement never counts toward a total, and a restored one counts again, with
-- no reconciliation needed.
--
-- HOW TO FILTER: edit the params block in each query. NULL means "no filter".
--   p_country   'CO' | 'VE' | NULL
--   p_currency  'COP' | 'USD' | 'EUR' | NULL
--   p_owner     an owners.id | NULL
--   p_from/p_to timestamps | NULL
--
-- A note on currency: a CO owner's ledger is COP and stores currency = NULL;
-- a VE owner's movements are USD or EUR. coalesce(currency,'COP') normalises
-- that, so 'COP' filters to Colombian ledgers. Amounts are never summed across
-- currencies — $50 and €20 are two debts, not one.


-- ════════════════════════════════════════════════════════════════════
-- 1. MONEY METRICS, one row per currency
--    Covers: total/average charge, total/average payment, avg plazo
-- ════════════════════════════════════════════════════════════════════
with params as (
  select
    null::text        as p_country,
    null::text        as p_currency,
    null::uuid        as p_owner,
    null::timestamptz as p_from,
    null::timestamptz as p_to
),
base as (
  select
    coalesce(m.currency, 'COP') as currency,
    m.type,
    m.amount,
    m.plazo_dias
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  cross join params p
  where m.deleted_at is null
    and (p.p_country  is null or o.country = p.p_country)
    and (p.p_currency is null or coalesce(m.currency, 'COP') = p.p_currency)
    and (p.p_owner    is null or o.id = p.p_owner)
    and (p.p_from     is null or m.created_at >= p.p_from)
    and (p.p_to       is null or m.created_at <  p.p_to)
)
select
  currency,
  count(*)                                                  as movements_total,
  count(*) filter (where type = 'charge')                   as charges_count,
  round(sum(amount) filter (where type = 'charge'), 2)      as charge_total,
  round(avg(amount) filter (where type = 'charge'), 2)      as charge_average,
  count(*) filter (where type = 'payment')                  as payments_count,
  round(sum(amount) filter (where type = 'payment'), 2)     as payment_total,
  round(avg(amount) filter (where type = 'payment'), 2)     as payment_average,
  -- Only charges carry a plazo, and it is optional ("Sin especificar"), so the
  -- average is over the charges that actually set one.
  round(avg(plazo_dias) filter (where type = 'charge' and plazo_dias is not null), 1) as plazo_average_days,
  count(*) filter (where type = 'charge' and plazo_dias is not null)                  as charges_with_plazo
from base
group by currency
order by currency;


-- ════════════════════════════════════════════════════════════════════
-- 2. CLIENTS AND MALA PAGA
--    Covers: clients created, malas pagas labelled / unlabelled
--    Currency does not apply — a client is not denominated in a currency.
-- ════════════════════════════════════════════════════════════════════
with params as (
  select
    null::text        as p_country,
    null::uuid        as p_owner,
    null::timestamptz as p_from,
    null::timestamptz as p_to
),
scoped_clients as (
  select c.id, c.created_at, c.is_flagged
  from public.clients c
  join public.owners o on o.id = c.owner_id
  cross join params p
  where (p.p_country is null or o.country = p.p_country)
    and (p.p_owner   is null or o.id = p.p_owner)
    and (p.p_from    is null or c.created_at >= p.p_from)
    and (p.p_to      is null or c.created_at <  p.p_to)
),
-- client_flags keeps the full history: a row per flagging, closed by
-- unflagged_at. Counting rows rather than the is_flagged boolean is what makes
-- "labelled" and "unlabelled" answerable over a period instead of only right now.
scoped_flags as (
  select f.flagged_at, f.unflagged_at
  from public.client_flags f
  join public.owners o on o.id = f.owner_id
  cross join params p
  where (p.p_country is null or o.country = p.p_country)
    and (p.p_owner   is null or o.id = p.p_owner)
)
select
  (select count(*) from scoped_clients)                    as clients_created,
  (select count(*) from scoped_clients where is_flagged)   as clients_currently_flagged,
  (select count(*) from scoped_flags f cross join params p
     where (p.p_from is null or f.flagged_at >= p.p_from)
       and (p.p_to   is null or f.flagged_at <  p.p_to))   as mala_paga_labelled,
  (select count(*) from scoped_flags f cross join params p
     where f.unflagged_at is not null
       and (p.p_from is null or f.unflagged_at >= p.p_from)
       and (p.p_to   is null or f.unflagged_at <  p.p_to)) as mala_paga_unlabelled;


-- ════════════════════════════════════════════════════════════════════
-- 3. BREAKDOWN BY COUNTRY AND OWNER
--    The same money metrics, split the two ways a VC will ask for.
-- ════════════════════════════════════════════════════════════════════
select
  o.country,
  o.business_name,
  o.id as owner_id,
  coalesce(m.currency, 'COP')                            as currency,
  count(distinct c.id)                                   as clients,
  count(m.id)                                            as movements,
  round(sum(m.amount) filter (where m.type = 'charge'), 2)  as charge_total,
  round(avg(m.amount) filter (where m.type = 'charge'), 2)  as charge_average,
  round(sum(m.amount) filter (where m.type = 'payment'), 2) as payment_total,
  round(avg(m.amount) filter (where m.type = 'payment'), 2) as payment_average,
  round(avg(m.plazo_dias) filter (where m.plazo_dias is not null), 1) as plazo_average_days
from public.owners o
join public.clients c   on c.owner_id = o.id
left join public.movements m on m.client_id = c.id and m.deleted_at is null
group by o.country, o.business_name, o.id, coalesce(m.currency, 'COP')
order by o.country, o.business_name, currency;
