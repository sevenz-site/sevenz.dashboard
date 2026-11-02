-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code that calls the new functions.
-- Re-runnable: the existing functions keep their exact signatures and are
-- replaced in place; the new ones are dropped by their full signature first.
--
-- ===========================================================================
-- 169: /admin METRICS BY FLOW -- phase A of the plan of 2026-10-31
--
-- The owner's request of 2026-10-31: metrics per feature, and three new ones
-- -- how many transactions of each kind (contado / fiado / abono), how much
-- money each kind moved, and how much went through catalog orders (contado /
-- fiado, with the pending ones apart). «Todo debe poder responder a los
-- filtros ya existentes de fecha, moneda, etc.» The plan and his answers live
-- in ../docs/PLANES-Y-CUENTAS-PLAN.md, section of 2026-10-31.
--
-- Four things, in this order:
--
--   1. THE DATE FILTER, IN THE BUSINESS'S ZONE. Every admin function compared
--      `created_at >= p_from and < p_to` with the day cut at midnight UTC, so
--      a Venezuelan sale at 9 p.m. on the 15th landed in the 16th -- the same
--      defect PL-1 fixed on the owner's screens on 2026-10-30. A helper now
--      compares calendar days: the row's day in the zone of ITS business
--      (Caracas for VE, Bogotá otherwise -- `zonaDelNegocio` in
--      lib/format.ts) against the requested days.
--
--      WHY THE SIGNATURES DO NOT CHANGE: production code sends
--      p_from = 'YYYY-MM-DD' and p_to = 'YYYY-MM-DDT23:59:59.999Z'. Reading
--      both as their UTC calendar day gives the same answer for that old call
--      and for the new one, which sends a bare 'YYYY-MM-DD' for both. So this
--      migration can run before or after the code without breaking either.
--
--   2. «POR NEGOCIO» PER CURRENCY. `admin_metrics_by_owner` (047) grouped by
--      business only, so with no currency filter a Venezuelan shop's dollars
--      and euros were added into one figure -- printed on /admin under a page
--      that says «Los montos nunca se suman entre monedas», and rolled into
--      «Por país» too. It stays as it is for the code already in production;
--      the screen moves to `admin_metrics_by_owner_money`, one row per
--      (business, currency).
--
--   3. `admin_metrics_transactions`: count and amount per kind, per currency.
--
--   4. `admin_metrics_orders`: catalog orders, registered (contado / fiado)
--      and pending, per currency.
--
-- THE RULES ARE REPORTES' RULES (lib/reports/facturacion.ts), on purpose: the
-- panel and the owner's own Reportes screen must not be able to disagree
-- about what «contado» or «abono» means. Two deliberate differences, both the
-- owner's answers of 2026-10-31:
--   - a split abono counts ONCE (per currency), not once per line -- since
--     CT-156 a split is one transaction in both histories;
--   - the abono paid at the moment of a credit sale counts as an abono in the
--     COUNT as well as in the amount (Reportes adds it to the amount only).
--
-- EVERYTHING IS SECURITY DEFINER: production revokes SELECT from service_role
-- on the customer tables, so a direct read would work in dev and fail there
-- (the /admin outage of 2026-09-05; see 039).

begin;

-- ── 0. The zone of a business, and whether a moment falls in the window ──

create or replace function public.admin_zona(p_country text)
returns text
language sql
immutable
as $$
  select case when p_country = 'VE' then 'America/Caracas' else 'America/Bogota' end;
$$;

-- p_from and p_to are read as calendar days (their UTC date: see the header).
-- Both ends are INCLUSIVE, which is what a date picker means by «hasta el 15».
create or replace function public.admin_en_ventana(
  p_ts      timestamptz,
  p_country text,
  p_from    timestamptz,
  p_to      timestamptz
)
returns boolean
language sql
stable
as $$
  select (p_from is null or (p_ts at time zone public.admin_zona(p_country))::date >= (p_from at time zone 'UTC')::date)
     and (p_to   is null or (p_ts at time zone public.admin_zona(p_country))::date <= (p_to   at time zone 'UTC')::date);
$$;

-- ── 1. The existing functions, same signatures, zone-aware dates ─────────

create or replace function public.admin_metrics_summary(
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
    round(avg(m.plazo_dias) filter (where m.type = 'charge' and m.plazo_dias is not null), 1) as plazo_average,
    count(*) filter (where m.type = 'charge' and m.plazo_dias is not null) as charges_with_plazo
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    and (p_country  is null or o.country = p_country)
    and (p_currency is null or coalesce(m.currency, 'COP') = p_currency)
    and (p_owners   is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and public.admin_en_ventana(m.created_at, o.country, p_from, p_to)
  group by coalesce(m.currency, 'COP')
  order by 1;
$$;

create or replace function public.admin_metrics_totals(
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
        and public.admin_en_ventana(c.created_at, o.country, p_from, p_to)),
    (select count(*) from public.clients c
       join public.owners o on o.id = c.owner_id
      where c.is_flagged
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and public.admin_en_ventana(f.flagged_at, o.country, p_from, p_to)),
    (select count(*) from public.client_flags f
       join public.owners o on o.id = f.owner_id
      where f.unflagged_at is not null
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and public.admin_en_ventana(f.unflagged_at, o.country, p_from, p_to));
$$;

-- The buckets are cut in the business's zone too, and handed back as midnight
-- UTC of that local day: the chart formats them with timeZone "UTC", so the
-- label it prints is the local day the bucket really is.
create or replace function public.admin_metrics_timeseries(
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
      date_trunc(v_bucket, m.created_at at time zone public.admin_zona(o.country)) at time zone 'UTC' as bucket,
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
      and public.admin_en_ventana(m.created_at, o.country, p_from, p_to)
    group by 1
  ),
  client_buckets as (
    select
      date_trunc(v_bucket, c.created_at at time zone public.admin_zona(o.country)) at time zone 'UTC' as bucket,
      count(*) as clients_created
    from public.clients c
    join public.owners o on o.id = c.owner_id
    where (p_country is null or o.country = p_country)
      and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
      and public.admin_en_ventana(c.created_at, o.country, p_from, p_to)
    group by 1
  )
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

-- Kept for the code already in production (it still sums currencies when no
-- currency filter is set -- see the header). Only its dates change. The
-- screen moves to `admin_metrics_by_owner_money` below; drop this one once no
-- deployed code calls it.
create or replace function public.admin_metrics_by_owner(
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
   and public.admin_en_ventana(m.created_at, o.country, p_from, p_to)
  where (p_country is null or o.country = p_country)
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
  group by o.id, o.business_name, o.country
  order by movements desc, o.business_name;
$$;

create or replace function public.admin_metrics_health(
  p_country text default null,
  p_owners  uuid[] default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns table (
  rejections_total            bigint,
  rejections_sin_moneda       bigint,
  rejections_pais_desconocido bigint,
  rejected_rows               bigint,
  movements_without_rate      bigint,
  screen_warnings             bigint
)
language sql
security definer
set search_path = public
as $$
  with anotaciones as (
    select r.*
      from public.movement_rejections r
      left join public.owners o on o.id = r.owner_id
     where (p_country is null or o.country = p_country)
       and (p_owners  is null or cardinality(p_owners) = 0 or r.owner_id = any(p_owners))
       and public.admin_en_ventana(r.created_at, o.country, p_from, p_to)
  ),
  rechazos as (
    select * from anotaciones where source in ('movimiento', 'cliente_nuevo', 'import')
  )
  select
    (select count(*) from rechazos),
    (select count(*) from rechazos where reason = 've_sin_moneda'),
    (select count(*) from rechazos where reason = 'pais_desconocido'),
    (select coalesce(sum(rows_affected), 0) from rechazos),
    (select count(*)
       from public.movements m
       join public.clients c on c.id = m.client_id
       join public.owners  o on o.id = c.owner_id
      where m.currency is not null
        and m.exchange_rate_used is null
        and m.deleted_at is null
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and public.admin_en_ventana(m.created_at, o.country, p_from, p_to)),
    (select count(*) from anotaciones where source = 'pantalla');
$$;

create or replace function public.admin_credit_inputs(
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
    and public.admin_en_ventana(cs.client_created_at, o.country, p_from, p_to);
$$;

create or replace function public.admin_credit_movements(
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
           'created_at', m.created_at,
           'applies_to_movement_id', m.applies_to_movement_id
         )
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    and c.trashed_at is null
    and c.deleted_at is null
    and (p_country is null or o.country = p_country)
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and public.admin_en_ventana(c.created_at, o.country, p_from, p_to)
  order by m.created_at, m.id;
$$;

-- ── 2. «Por negocio», one row per (business, currency) ──────────────────

drop function if exists public.admin_metrics_by_owner_money(text, text, uuid[], timestamptz, timestamptz);

create function public.admin_metrics_by_owner_money(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  owner_id      uuid,
  currency      text,
  charges       bigint,
  payments      bigint,
  charge_total  numeric,
  payment_total numeric
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    coalesce(m.currency, 'COP'),
    count(*) filter (where m.type = 'charge'),
    count(*) filter (where m.type = 'payment'),
    round(coalesce(sum(m.amount) filter (where m.type = 'charge'), 0), 2),
    round(coalesce(sum(m.amount) filter (where m.type = 'payment'), 0), 2)
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    and (p_country  is null or o.country = p_country)
    and (p_currency is null or coalesce(m.currency, 'COP') = p_currency)
    and (p_owners   is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and public.admin_en_ventana(m.created_at, o.country, p_from, p_to)
  group by o.id, coalesce(m.currency, 'COP')
  order by 1, 2;
$$;

-- ── 3. Transactions: how many and how much, per kind and per currency ────
--
-- kind / origin:
--   contado / venta          a (sale, book) that was paid in full: payments in
--                            that book and NO live charge in it. Amount = what
--                            was collected. Same key as `claveDeFila`.
--   fiado   / venta          a charge born from a sale: what was left owing.
--   fiado   / deuda_antigua  the old debt a new client is born with (167).
--   fiado   / libreta        a charge read from a notebook photo. It carries
--                            the NOTEBOOK's date, so a date filter places it
--                            there, not on the day it was imported.
--   fiado   / manual         any other charge: typed by hand before the sale
--                            flow existed (until 2026-10-24).
--   abono   / abono          a payment movement. A split counts once per
--                            currency (`payment_group_id`).
--   abono   / al_vender      what the client paid AT THE MOMENT of a credit
--                            sale: payments of a (sale, book) that DID leave a
--                            charge. It writes no payment movement, so without
--                            this row it would vanish (Reportes, decision 1).
--
-- The book is normalised to the ledger's spelling: `sale_payments` writes the
-- Colombian book as 'COP' and `movements` writes it NULL; joining the raw
-- columns never matches and turns every Colombian credit sale into contado
-- (the phantom row of 2026-10-20). Both sides go through 'COP' here.
--
-- Dates: a sale by the sale's own `created_at`, a movement by its own, both in
-- the zone of the business. Deleted sales and movements never count. Clients
-- in the Papelera DO count, as in Reportes: the money moved.

drop function if exists public.admin_metrics_transactions(text, text, uuid[], timestamptz, timestamptz);

create function public.admin_metrics_transactions(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  kind     text,
  origin   text,
  currency text,
  tx_count bigint,
  amount   numeric
)
language sql
security definer
set search_path = public
as $$
  with duenos as (
    select o.id, o.country
    from public.owners o
    where (p_country is null or o.country = p_country)
      and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
  ),
  ventas as (
    select s.id
    from public.sales s
    join duenos d on d.id = s.owner_id
    where s.deleted_at is null
      and public.admin_en_ventana(s.created_at, d.country, p_from, p_to)
  ),
  pagos as (
    select sp.sale_id,
           case when sp.currency in ('USD', 'EUR') then sp.currency else 'COP' end as libro,
           sum(sp.amount) as amount
    from public.sale_payments sp
    join ventas v on v.id = sp.sale_id
    group by 1, 2
  ),
  libros_fiados as (
    select distinct m.sale_id, coalesce(m.currency, 'COP') as libro
    from public.movements m
    join ventas v on v.id = m.sale_id
    where m.type = 'charge' and m.deleted_at is null
  ),
  pares as (
    select p.libro, p.amount, (f.sale_id is not null) as dejo_fiado
    from pagos p
    left join libros_fiados f on f.sale_id = p.sale_id and f.libro = p.libro
    where p.amount > 0
  ),
  movs as (
    select m.type,
           m.amount,
           coalesce(m.currency, 'COP') as libro,
           case
             when m.sale_id is not null       then 'venta'
             when m.is_old_debt               then 'deuda_antigua'
             when m.source = 'photo_import'   then 'libreta'
             else 'manual'
           end as origen,
           coalesce(m.payment_group_id, m.id) as grupo
    from public.movements m
    join public.clients c on c.id = m.client_id
    join duenos d on d.id = c.owner_id
    where m.deleted_at is null
      and public.admin_en_ventana(m.created_at, d.country, p_from, p_to)
  ),
  filas as (
    select 'contado'::text as kind, 'venta'::text as origin, libro as currency,
           count(*)::bigint as tx_count, round(sum(amount), 2) as amount
    from pares where not dejo_fiado group by libro
    union all
    select 'abono', 'al_vender', libro, count(*), round(sum(amount), 2)
    from pares where dejo_fiado group by libro
    union all
    select 'abono', 'abono', libro, count(distinct grupo), round(sum(amount), 2)
    from movs where type = 'payment' group by libro
    union all
    select 'fiado', origen, libro, count(*), round(sum(amount), 2)
    from movs where type <> 'payment' group by origen, libro
  )
  select kind, origin, currency, tx_count, amount
  from filas
  where p_currency is null or currency = p_currency
  order by 1, 2, 3;
$$;

-- ── 4. Catalog orders: registered (contado / fiado) and pending ─────────
--
-- REGISTERED: the sales that came from an order (`sales.catalog_order_id`,
-- the real link since 158 -- one order can give one sale per currency). The
-- amount of each (sale, book) is what was SOLD in that book, Σ quantity ×
-- price of its lines -- the same figure as Reportes' «Transacciones por
-- catálogo» -- and it is contado or fiado by the same key as above.
--
-- PENDING: orders received in the window that are neither registered nor
-- discarded -- the same status rule as the bell (`countUnregisteredOrders`).
-- Lines removed by the owner do not count. One difference from the bell, on
-- purpose: a currency of the order that ALREADY became a sale is not counted
-- as pending again, or a half-registered order would be added twice -- once
-- here and once above.
--
-- Pending lines keep their own currency, which for an order can be USDT or
-- VES as well: they are reported as such, never converted.

drop function if exists public.admin_metrics_orders(text, text, uuid[], timestamptz, timestamptz);

create function public.admin_metrics_orders(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  status   text,
  kind     text,
  currency text,
  orders   bigint,
  amount   numeric
)
language sql
security definer
set search_path = public
as $$
  with duenos as (
    select o.id, o.country
    from public.owners o
    where (p_country is null or o.country = p_country)
      and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
  ),
  ventas as (
    select s.id, s.catalog_order_id
    from public.sales s
    join duenos d on d.id = s.owner_id
    where s.deleted_at is null
      and s.catalog_order_id is not null
      and public.admin_en_ventana(s.created_at, d.country, p_from, p_to)
  ),
  lineas as (
    select sl.sale_id,
           case when sl.currency in ('USD', 'EUR') then sl.currency else 'COP' end as libro,
           sum(sl.quantity * sl.unit_price) as amount
    from public.sale_lines sl
    join ventas v on v.id = sl.sale_id
    group by 1, 2
  ),
  libros_fiados as (
    select distinct m.sale_id, coalesce(m.currency, 'COP') as libro
    from public.movements m
    join ventas v on v.id = m.sale_id
    where m.type = 'charge' and m.deleted_at is null
  ),
  registrados as (
    select v.catalog_order_id, l.libro, l.amount, (f.sale_id is not null) as dejo_fiado
    from lineas l
    join ventas v on v.id = l.sale_id
    left join libros_fiados f on f.sale_id = l.sale_id and f.libro = l.libro
  ),
  pedidos_pendientes as (
    select co.id
    from public.catalog_orders co
    join duenos d on d.id = co.owner_id
    where co.status not in ('registered', 'discarded')
      and public.admin_en_ventana(co.created_at, d.country, p_from, p_to)
  ),
  ya_vendidos as (
    select distinct s.catalog_order_id,
           case when sl.currency in ('USD', 'EUR') then sl.currency else 'COP' end as libro
    from public.sales s
    join public.sale_lines sl on sl.sale_id = s.id
    join pedidos_pendientes p on p.id = s.catalog_order_id
    where s.deleted_at is null
  ),
  pendientes as (
    select i.order_id, i.currency, i.quantity * i.unit_price as amount
    from public.catalog_order_items i
    join pedidos_pendientes p on p.id = i.order_id
    where i.deleted_at is null
      and not exists (
        select 1 from ya_vendidos y
        where y.catalog_order_id = i.order_id and y.libro = i.currency
      )
  ),
  filas as (
    select 'registrado'::text as status,
           case when dejo_fiado then 'fiado' else 'contado' end as kind,
           libro as currency,
           count(distinct catalog_order_id)::bigint as orders,
           round(sum(amount), 2) as amount
    from registrados
    group by 2, 3
    union all
    select 'pendiente', null, currency, count(distinct order_id), round(sum(amount), 2)
    from pendientes
    group by currency
  )
  select status, kind, currency, orders, amount
  from filas
  where p_currency is null or currency = p_currency
  order by 1 desc, 2, 3;
$$;

-- These read every owner's data. Supabase grants EXECUTE on new functions to
-- anon and authenticated; only service_role may run them. `create or replace`
-- keeps the grants of the existing ones; they are set again anyway so a re-run
-- on a database where they drifted still ends right.
revoke execute on function public.admin_metrics_summary(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_totals(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_timeseries(text, text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_by_owner(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_credit_inputs(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_credit_movements(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_by_owner_money(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_transactions(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_orders(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.admin_metrics_summary(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_totals(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_timeseries(text, text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_by_owner(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_credit_inputs(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_credit_movements(text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_by_owner_money(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_transactions(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_orders(text, text, uuid[], timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '169_metricas_por_flujo',
  'Métricas de /admin por flujo (fase A del plan del 2026-10-31). Las fechas de todas las funciones del panel se cortan en la zona de cada negocio en vez de en UTC, sin cambiar sus firmas. «Por negocio» pasa a una fila por moneda (admin_metrics_by_owner_money): la vieja sumaba dólares con euros. Nuevas admin_metrics_transactions (cantidad y monto de contado, fiado y abono, por moneda, con el fiado desglosado por origen) y admin_metrics_orders (pedidos registrados de contado y fiado, y pendientes aparte), con las mismas reglas que Reportes.'
)
on conflict (key) do nothing;

commit;
