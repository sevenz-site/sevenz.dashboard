-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, after 169. Re-runnable: the new functions are
-- dropped first (both their signatures are written out), and
-- `admin_metrics_transactions` keeps its exact signature and return columns,
-- so `create or replace` is enough for it.
--
-- ===========================================================================
-- 176: THE ACTIVITY CHART COUNTS WHAT THE CARDS COUNT, AND GAINS «DE CONTADO»
--
-- The owner's request of 2026-11-02 for /admin → Transacciones: «El bar chart
-- debe incluir las tres barras, una por tipo de transacción "Fiados",
-- "Abonos" y "De contado"».
--
-- WHY A NEW FUNCTION AND NOT A COLUMN ON `admin_metrics_timeseries`: that one
-- counts MOVEMENTS, and a cash sale writes none -- there is nothing there to
-- count. Its «charges» and «payments» also follow an older rule than the cards
-- above the chart (169): a split payment counted once per line, and the money
-- paid at the moment of a credit sale did not count at all. Adding contado to
-- it would have put two different rules in one chart.
--
-- ONE CLASSIFICATION, TWO READERS. The rule that decides what is contado,
-- fiado or abono -- the (sale, book) pairs, the COP/NULL normalisation, the
-- split payment counted once -- moves from 169's `admin_metrics_transactions`
-- into `admin_tx_rows`, one row per transaction. The tables read it grouped by
-- kind; the chart reads it grouped by date. They cannot disagree, because
-- there is only one place to change. Written twice, the chart and the cards
-- would drift exactly the way «Por negocio» did before 169.
--
-- THE PROOF THAT NOTHING MOVED: `admin_metrics_transactions` must return the
-- same rows, to the cent, before and after this migration, for the same
-- filters. Checked in dev against a snapshot taken before running it.
--
-- THE DATE OF EACH TRANSACTION: a sale's own `created_at` for contado and for
-- the money paid when selling on credit, a movement's own for fiados and
-- abonos -- all in the zone of the business, the same as the window filter.

drop function if exists public.admin_tx_rows(text, text, uuid[], timestamptz, timestamptz);

create function public.admin_tx_rows(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  kind        text,
  origin      text,
  currency    text,
  amount      numeric,
  occurred_at timestamptz,
  country     text
)
language sql
stable
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
    select s.id, s.created_at, d.country
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
    select p.libro, p.amount, (f.sale_id is not null) as dejo_fiado, v.created_at, v.country
    from pagos p
    join ventas v on v.id = p.sale_id
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
           coalesce(m.payment_group_id, m.id) as grupo,
           m.created_at,
           d.country
    from public.movements m
    join public.clients c on c.id = m.client_id
    join duenos d on d.id = c.owner_id
    where m.deleted_at is null
      and public.admin_en_ventana(m.created_at, d.country, p_from, p_to)
  ),
  filas as (
    select (case when dejo_fiado then 'abono' else 'contado' end)::text as kind,
           (case when dejo_fiado then 'al_vender' else 'venta' end)::text as origin,
           libro as currency, amount, created_at as occurred_at, country
    from pares
    union all
    -- A split payment is ONE transaction: its lines share a group, a book
    -- and a timestamp, so they collapse into one row here.
    select 'abono', 'abono', libro, sum(amount), min(created_at), min(country)
    from movs where type = 'payment'
    group by grupo, libro
    union all
    select 'fiado', origen, libro, amount, created_at, country
    from movs where type <> 'payment'
  )
  select kind, origin, currency, amount, occurred_at, country
  from filas
  where p_currency is null or currency = p_currency;
$$;

-- 169's function, same signature and same columns, now reading the shared rows.
create or replace function public.admin_metrics_transactions(
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
  select kind, origin, currency, count(*)::bigint, round(sum(amount), 2)
  from public.admin_tx_rows(p_country, p_currency, p_owners, p_from, p_to)
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

drop function if exists public.admin_metrics_transactions_trend(text, text, text, uuid[], timestamptz, timestamptz);

create function public.admin_metrics_transactions_trend(
  p_bucket   text default 'week',
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  bucket   timestamptz,
  contado  bigint,
  fiado    bigint,
  abono    bigint
)
language sql
security definer
set search_path = public
as $$
  -- COUNTS, never amounts: a bar that added dollars to euros would be the
  -- fault of 2026-10-20 again. The same bucket rule as `admin_metrics_timeseries`.
  select date_trunc(
           case when p_bucket in ('day', 'week', 'month') then p_bucket else 'week' end,
           occurred_at at time zone public.admin_zona(country)
         ) at time zone 'UTC' as bucket,
         count(*) filter (where kind = 'contado') as contado,
         count(*) filter (where kind = 'fiado')   as fiado,
         count(*) filter (where kind = 'abono')   as abono
  from public.admin_tx_rows(p_country, p_currency, p_owners, p_from, p_to)
  group by 1
  order by 1;
$$;

revoke execute on function public.admin_tx_rows(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_transactions(text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_metrics_transactions_trend(text, text, text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_tx_rows(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_transactions(text, text, uuid[], timestamptz, timestamptz) to service_role;
grant execute on function public.admin_metrics_transactions_trend(text, text, text, uuid[], timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '176_grafica_de_transacciones',
  'La gráfica de /admin → Transacciones cuenta lo mismo que sus tarjetas y suma la barra «De contado» (pedido del dueño el 2026-11-02). La clasificación contado / fiado / abono pasa a una sola función, admin_tx_rows, que leen las tablas y la gráfica; admin_metrics_transactions devuelve exactamente lo mismo que antes. Va después de la 169.'
)
on conflict (key) do nothing;
