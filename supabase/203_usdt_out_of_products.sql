-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that stops offering USDT (CLAUDE.md, deploy step 1).
-- Re-runnable: the conversion only touches rows still in USDT, the constraints are dropped
-- and recreated by name, and the ledger row uses `on conflict`.
--
-- ===========================================================================
-- 203: USDT LEAVES PRODUCTS ENTIRELY -- sale price AND cost (CT-171, v0.6.0)
--
-- Owner's decision of 2026-11-12: «Quita USDT del precio de costo y del precio de venta»,
-- and earlier the same day «elimínalo del todo para evitar que se vuelva a publicar».
--
-- WHAT THIS DISPLACES, so nobody rebuilds it by accident:
--   · CT-79, the temporary lock of 2026-10-16 that HID the USDT sale price and was meant
--     to be lifted once USDT existed in the money ledger. It is not lifted: it is removed.
--   · The same day's «en costo se mantiene». USDT stops being a cost currency too.
--   · NOT the calculator: its USDT tab reads /api/usdt and never touched these tables. The
--     owner did not name it, so it stays.
--
-- WHY THE LOCK WAS NOT ENOUGH. It lived in the product form and in its server action. The
-- public catalogue builds its currency list from `product_currencies` and never read the
-- lock, so a product saved with USDT before 2026-10-16 kept offering «Paga en USDT» to the
-- customer -- an order the shopkeeper could not register, since `movements.currency` only
-- holds USD and EUR. Measured on 2026-11-12: zero such rows in production and in dev. The
-- constraints below are what keeps it at zero.
--
-- THE ONE PRODUCT WITH A USDT COST (production, measured 2026-11-12). Converted to dollars
-- WITH TODAY'S ARITHMETIC, owner's choice that day: cost_usd = cost_usdt × (Bs per USDT ÷
-- Bs per dollar at the owner's effective rate). That is exactly the number the app was
-- already using for its margin -- it converted USDT through Binance P2P and dollars through
-- the BCV -- so the margin the shopkeeper sees does not move. Rejected: one to one. Measured
-- in dev on 2026-11-12 when this ran: USDT at 1.066 Bs and the BCV dollar at 904,45 Bs, so
-- 10 USDT counted as $11.79. Writing $10 would have made that cost about 15% cheaper than
-- the app had been counting it, and its margin would have jumped with nothing changed.
--   The ratio is frozen at the day this runs, and the ledger row records it. If there is no
--   USDT price, or it is more than three days old, the migration STOPS rather than guess:
--   a wrong cost is silent, a failed migration is not.
--   Past sales are untouched: `sale_lines.unit_cost` was frozen in the line's own currency
--   when each sale happened (migration 194).
--
-- WHAT STAYS:
--   · `catalog_order_items.currency` still accepts USDT. Orders are history; zero rows today.
--   · `usdt_p2p_rate` and the cron that fills it. The calculator does not need it, but the
--     catalogue order function (113) still reads it on a path no product can reach now.
--
-- WHAT STOPS THE MIGRATION ON PURPOSE: a product whose sale price is WRITTEN in USDT (its
-- base) or pinned by hand in USDT. Deleting those would reprice the product silently -- the
-- same number read as another currency. Zero in production and dev on 2026-11-12; if one
-- appears before this runs, it has to be looked at by hand.
-- ===========================================================================

begin;

-- 1. Refuse to reprice anything.
do $$
declare
  v_base int;
  v_pinned int;
begin
  select count(*) into v_base from public.products
   where 'USDT' in (base_currency, base_currency_retail, base_currency_wholesale);
  select count(*) into v_pinned from public.product_price_overrides where currency = 'USDT';
  if v_base > 0 or v_pinned > 0 then
    raise exception '203: % products priced in USDT and % prices pinned in USDT. Resolve them by hand first.',
      v_base, v_pinned;
  end if;
end $$;

-- 2. The extra currencies: a USDT that is not the base only adds a converted price.
delete from public.product_currencies where currency = 'USDT';

-- 3. USDT costs -> dollars, with today's arithmetic.
do $$
declare
  v_usdt numeric;
  v_usdt_at timestamptz;
  v_bcv_usd numeric;
  v_n int;
  v_ratio numeric;
  v_ratios text := '';
  r record;
begin
  select count(*) into v_n from public.products where cost_currency = 'USDT';
  if v_n = 0 then
    return;
  end if;

  select bs_per_usdt, updated_at into v_usdt, v_usdt_at from public.usdt_p2p_rate where id;
  if v_usdt is null or v_usdt_at < now() - interval '3 days' then
    raise exception '203: % products have a USDT cost and there is no USDT price from the last three days (last: %). Not converting blind.',
      v_n, v_usdt_at;
  end if;
  select g.usd into v_bcv_usd from public.get_current_bcv_rate() g;

  for r in
    select p.id, p.cost,
           case when s.rate_mode = 'CUSTOM' and s.custom_rate_usd > 0
                then s.custom_rate_usd else v_bcv_usd end as bs_per_usd
      from public.products p
      left join public.owner_exchange_settings s on s.owner_id = p.owner_id
     where p.cost_currency = 'USDT'
  loop
    if r.bs_per_usd is null or r.bs_per_usd <= 0 then
      raise exception '203: product % has a USDT cost and its owner has no dollar rate. Not converting blind.', r.id;
    end if;
    v_ratio := v_usdt / r.bs_per_usd;
    update public.products
       set cost = case when r.cost is null then null else round(r.cost * v_ratio, 4) end,
           cost_currency = 'USD'
     where id = r.id;
    v_ratios := v_ratios || format(' %s: x%s (USDT %s Bs / dólar %s Bs);', r.id, round(v_ratio, 6), v_usdt, r.bs_per_usd);
  end loop;

  -- Recorded next to the migration, so the conversion can be audited later.
  insert into public.schema_migrations (key, description)
  values (
    '203_usdt_out_of_products_conversion',
    'Costos en USDT pasados a dólares con la cuenta del día (decisión del dueño el 2026-11-12).' || v_ratios
  )
  on conflict (key) do nothing;
end $$;

-- 4. And it cannot come back. Every check on these three tables that mentions USDT is
-- dropped -- found by its definition, since two were created inline and carry Postgres's
-- generated names -- and recreated without it, under names this file controls.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.products'::regclass,
                          'public.product_currencies'::regclass,
                          'public.product_price_overrides'::regclass)
       and pg_get_constraintdef(c.oid) like '%USDT%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.products drop constraint if exists products_base_currency_check;
alter table public.products add constraint products_base_currency_check
  check (base_currency in ('COP', 'USD', 'EUR', 'VES'));

alter table public.products drop constraint if exists products_base_currency_retail_check;
alter table public.products add constraint products_base_currency_retail_check
  check (base_currency_retail in ('COP', 'USD', 'EUR', 'VES'));

alter table public.products drop constraint if exists products_base_currency_wholesale_check;
alter table public.products add constraint products_base_currency_wholesale_check
  check (base_currency_wholesale in ('COP', 'USD', 'EUR', 'VES'));

alter table public.products drop constraint if exists products_cost_currency_check;
alter table public.products add constraint products_cost_currency_check
  check (cost_currency is null or cost_currency in ('COP', 'USD', 'EUR', 'VES', 'OTHER'));

alter table public.product_currencies drop constraint if exists product_currencies_currency_check;
alter table public.product_currencies add constraint product_currencies_currency_check
  check (currency in ('COP', 'USD', 'EUR'));

-- PINNED PRICES: ONLY DOLLARS AND EUROS, which is migration 085's rule minus USDT. 085
-- replaced the inline check with `product_price_overrides_fixable_currency` and took out
-- bolívares (a pinned bolívar price ages on its own) and pesos (a Colombian shop has nothing
-- to convert). The first version of this file recreated the INLINE check from 083 instead,
-- which quietly let bolívares and pesos back in -- `qa:catalogo` 7e caught it in dev on
-- 2026-11-12. The bad check is dropped here so a re-run repairs a database that ran it, and
-- any row it let in is removed, exactly as 085 did with its own.
alter table public.product_price_overrides drop constraint if exists product_price_overrides_currency_check;
delete from public.product_price_overrides where currency not in ('USD', 'EUR');
alter table public.product_price_overrides drop constraint if exists product_price_overrides_fixable_currency;
alter table public.product_price_overrides add constraint product_price_overrides_fixable_currency
  check (currency in ('USD', 'EUR'));

insert into public.schema_migrations (key, description)
values (
  '203_usdt_out_of_products',
  'USDT fuera de los productos (CT-171, v0.6.0): sin precio de venta ni costo en USDT, y las restricciones de products, product_currencies y product_price_overrides ya no lo admiten. Los costos en USDT pasan a dólares con la cuenta del día. Los pedidos viejos y la calculadora no se tocan.'
)
on conflict (key) do nothing;

commit;
