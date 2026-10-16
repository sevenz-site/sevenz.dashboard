-- EACH TIER HAS ITS OWN CURRENCIES AND ITS OWN BASE.
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- WHAT THE OWNER REPORTED
--
-- 2026-10-15: adding or removing a currency on one tier did it on the other
-- as well. «Ambos deben actuar independientes, un producto puede tener los
-- tres precios al detal pero solo uno al mayor.»
--
-- It was not a regression. `catalog-product-dialog.tsx` has always held ONE
-- `currencies` state and handed the same add/remove callbacks to both tier
-- sections, so the two blocks were painting the same list twice.
--
-- AND IT IS THE CASE HE DESCRIBED ON 2026-10-14 -- «al detal en dolares pero
-- al mayor en euros, USDT y dolares» -- which migration 111's header recorded
-- as impossible to express, saying a `tier` column would be needed first.
-- This is that column, plus the part 111 did not foresee.
--
-- ===========================================================================
-- A TIER COLUMN IS NOT ENOUGH, AND THAT IS THE WHOLE DIFFICULTY
--
-- The obvious fix is a `tier` on `product_currencies`. It covers "three at
-- retail, one at wholesale" only while that one is the currency the price is
-- TYPED in, because `products.base_currency` was one column holding the unit
-- of BOTH `price_retail` and `price_wholesale`.
--
-- Asked on 2026-10-15 with the two cases spelled out, the owner chose the
-- second: wholesale must be able to be offered in euros while the retail
-- price is still typed in dollars. That needs a base PER TIER, which is why
-- this migration touches `products` -- the table holding real prices -- and
-- not only the satellite.
--
-- ===========================================================================
-- THE FAILURE THIS IS SHAPED TO PREVENT
--
-- `base_currency` is read in 12 TypeScript files and five SQL functions. The
-- dangerous outcome is not a crash: it is ONE missed read that prices the
-- wholesale tier with the retail base. A product typed as USD 6.01 would be
-- quoted as EUR 6.01 -- about 8% dearer -- and the figure is entirely
-- plausible, so nobody would notice.
--
-- Three things are shaped against that, and none of them is a comment:
--
-- 1. **The new columns are NOT NULL, backfilled.** Not "null means fall back
--    to `base_currency`". A fallback makes a missed read site look correct
--    forever; a backfilled column makes it correct only until the shopkeeper
--    changes a base, which is at least a condition a test can reproduce.
-- 2. **Each tier's block carries its own base in the payload.** A caller
--    holding a block has everything needed to price it, so there is no
--    product-level base in reach to grab by mistake.
-- 3. **`create_catalog_order` reads `v_base` once, next to the price**, and
--    `p.base_currency` no longer appears anywhere in its body. That was
--    checked by generating this file and asserting on it, not by reading.
--
-- ===========================================================================
-- `products.base_currency` STAYS, AND STOPS PRICING ANYTHING
--
-- It is not dropped: the owner's grid, the filters and the product card read
-- it, and dropping a column in use is how a deploy takes down a screen that
-- had nothing to do with the change. From here it means "the product's
-- default currency" -- what a new tier starts at -- and never the unit of a
-- price. Anything converting an amount uses the tier's own.
--
-- ===========================================================================
-- NOBODY CHANGES PRICE
--
-- The backfill sets both new columns to the current `base_currency` and
-- duplicates every existing currency row into both tiers, so every product
-- ends up expressing exactly what it expresses today. The migration on its
-- own moves nothing; the risk lives in the code that reads it afterwards.

begin;

-- ===========================================================================
-- 1. A BASE PER TIER
-- ===========================================================================

alter table public.products
  add column if not exists base_currency_retail text,
  add column if not exists base_currency_wholesale text;

-- THE BACKFILL RUNS BEFORE THE `not null`, and the order is not cosmetic:
-- migration 087 learned this the hard way with `cost_currency`, where adding
-- the constraint first blew up with 23514 because `add constraint` evaluates
-- every row that already exists.
update public.products
set base_currency_retail = coalesce(base_currency_retail, base_currency),
    base_currency_wholesale = coalesce(base_currency_wholesale, base_currency);

alter table public.products alter column base_currency_retail set not null;
alter table public.products alter column base_currency_wholesale set not null;

-- The same set `base_currency` already accepts (migration 083). Repeated
-- rather than referenced because a check constraint cannot point at another.
alter table public.products drop constraint if exists products_base_currency_retail_check;
alter table public.products add constraint products_base_currency_retail_check
  check (base_currency_retail in ('COP', 'USD', 'EUR', 'USDT', 'VES'));

alter table public.products drop constraint if exists products_base_currency_wholesale_check;
alter table public.products add constraint products_base_currency_wholesale_check
  check (base_currency_wholesale in ('COP', 'USD', 'EUR', 'USDT', 'VES'));

comment on column public.products.base_currency is
  'The product default currency -- what a new tier starts at. Since migration 114 it prices NOTHING: price_retail is expressed in base_currency_retail and price_wholesale in base_currency_wholesale. Kept because the owner grid, the filters and the product card read it.';
comment on column public.products.base_currency_retail is
  'The currency price_retail is written in. Converting the retail price with any other base misprices it silently.';
comment on column public.products.base_currency_wholesale is
  'The currency price_wholesale is written in. It can differ from the retail one -- owner decision, 2026-10-15.';

-- ===========================================================================
-- 2. THE CURRENCY LIST GAINS ITS TIER
--
-- THE OLD PRIMARY KEY COMES OFF BEFORE THE COPIES GO IN, and that ordering is
-- the only tricky part of this file: with `(product_id, currency)` still in
-- force, inserting the wholesale twin of a retail row collides on it. Drop
-- first, duplicate, then key on the triple.
--
-- RE-RUNNABLE: the `not exists` guard stops a second run duplicating again,
-- and the key is dropped by name right before it is added back.
-- ===========================================================================

alter table public.product_currencies add column if not exists tier text;

-- Everything that exists today was written by a form with one shared list, so
-- it applies to both tiers. Marking them retail first and copying to wholesale
-- is what keeps every product expressing exactly what it expresses today.
update public.product_currencies set tier = 'retail' where tier is null;

alter table public.product_currencies drop constraint if exists product_currencies_pkey;

insert into public.product_currencies (product_id, tier, currency)
select c.product_id, 'wholesale', c.currency
from public.product_currencies c
where c.tier = 'retail'
  and not exists (
    select 1
    from public.product_currencies w
    where w.product_id = c.product_id
      and w.tier = 'wholesale'
      and w.currency = c.currency
  );

alter table public.product_currencies alter column tier set not null;

alter table public.product_currencies drop constraint if exists product_currencies_tier_check;
alter table public.product_currencies add constraint product_currencies_tier_check
  check (tier in ('retail', 'wholesale'));

alter table public.product_currencies drop constraint if exists product_currencies_pkey;
alter table public.product_currencies add primary key (product_id, tier, currency);

comment on table public.product_currencies is
  'The currencies each TIER of a product is offered in. Keyed (product_id, tier, currency) since migration 114: before that it was one list per product, so removing a currency from one tier removed it from the other -- which is what the owner reported on 2026-10-15. VES is still not here on purpose (migration 087): it is the currency the customer pays in, shown computed, never one a price is set in.';

-- ===========================================================================
-- 3. THE CURRENCY LIST, NOW PER TIER
--
-- BOTH SIGNATURES ARE DROPPED. CLAUDE.md documents why: dropping only the old
-- one makes the file work exactly once, and dropping neither leaves two
-- overloads for PostgREST to choose between.
-- ===========================================================================

drop function if exists public.product_catalog_currencies(uuid, text);
drop function if exists public.product_catalog_currencies(uuid, text, text);

create function public.product_catalog_currencies(p_product_id uuid, p_tier text, p_base text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_agg(x.currency order by (x.currency = p_base) desc, x.currency asc)
  from (
    select p_base as currency
    union
    select c.currency
    from public.product_currencies c
    where c.product_id = p_product_id and c.tier = p_tier
  ) x
$$;

revoke execute on function public.product_catalog_currencies(uuid, text, text) from public;
revoke execute on function public.product_catalog_currencies(uuid, text, text) from anon;
revoke execute on function public.product_catalog_currencies(uuid, text, text) from authenticated;

comment on function public.product_catalog_currencies(uuid, text, text) is
  'The currencies ONE TIER of a product can be ordered in: the ones enabled for that tier plus its base, which always counts. The base comes first. Internal: only the catalogue SECURITY DEFINER functions call it.';

-- ===========================================================================
-- 4. THE CATALOGUE
-- ===========================================================================

drop function if exists public.get_shared_catalog(text);

create function public.get_shared_catalog(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_business text;
  v_logo_path text;
  v_whatsapp text;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  v_products json;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country
    into v_business, v_logo_path, v_whatsapp, v_country
  from public.owners
  where id = v_owner_id;

  -- THE PRICE OF ONE UNIT, not the lowest one (migration 107): the front page
  -- shows what buying one costs, and the wholesale price appears in the detail
  -- once the quantity reaches it.
  select json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'unit', p.unit,
      'photo_path', p.photo_path,
      -- THE APPLICABLE TIER'S BASE, not the product's. The card shows one
      -- price, and that price is written in this tier's currency.
      'base_currency', pr.base,
      'currencies', public.product_catalog_currencies(p.id, pr.tier, pr.base),
      'stock', p.stock_opening,
      'price', pr.amount,
      'tier', pr.tier,
      'pinned', coalesce(ov.pinned, '{}'::json)
    ) order by p.name asc
  )
  into v_products
  from public.products p
  -- THE TIER CARRIES ITS OWN BASE OUT OF THE LATERAL (114). Recomputing it
  -- with a `case` at each use is how one of the two ends up reading the other
  -- tier's base, which is the silent 8% mispricing this migration exists to
  -- make impossible.
  join lateral (
    select c.tier, c.amount, c.base
    from (
      select 'retail'::text as tier, p.price_retail as amount,
             p.base_currency_retail as base, 1 as prioridad
      where p.published_retail and p.price_retail is not null
      union all
      select 'wholesale'::text, p.price_wholesale,
             p.base_currency_wholesale, 2
      where p.published_wholesale and p.price_wholesale is not null
    ) c
    order by c.prioridad asc
    limit 1
  ) pr on true
  left join lateral (
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = pr.tier
  ) ov on true
  where p.owner_id = v_owner_id
    and p.trashed_at is null
    and (p.published_retail or p.published_wholesale);

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_logo_path', v_logo_path,
    'owner_whatsapp', v_whatsapp,
    'owner_country', v_country,
    'products', coalesce(v_products, '[]'::json),
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

revoke execute on function public.get_shared_catalog(text) from public;
grant execute on function public.get_shared_catalog(text) to anon, authenticated;

-- ===========================================================================
-- 5. A PRODUCT'S DETAIL
-- ===========================================================================

drop function if exists public.get_shared_product(text, uuid);

create function public.get_shared_product(p_token text, p_product_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_business text;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  p public.products%rowtype;
  v_retail_pinned json;
  v_wholesale_pinned json;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  -- OWNER AND PUBLISHED, because `p_product_id` arrives from the URL. Without
  -- this, changing the identifier in the address bar would show another
  -- business's product -- checked on 2026-10-14: it returns null, as it must.
  select * into p
  from public.products
  where id = p_product_id
    and owner_id = v_owner_id
    and trashed_at is null
    and (published_retail or published_wholesale);

  if not found then
    return null;
  end if;

  select json_object_agg(o.currency, o.amount) into v_retail_pinned
  from public.product_price_overrides o
  where o.product_id = p.id and o.tier = 'retail';

  select json_object_agg(o.currency, o.amount) into v_wholesale_pinned
  from public.product_price_overrides o
  where o.product_id = p.id and o.tier = 'wholesale';

  select business_name, country into v_business, v_country
  from public.owners
  where id = v_owner_id;

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_country', v_country,
    'id', p.id,
    'name', p.name,
    'unit', p.unit,
    'description', p.description,
    'photo_path', p.photo_path,
    -- THE PRODUCT'S DEFAULT BASE, kept for whatever reads a product as a
    -- whole. IT NO LONGER PRICES ANYTHING: since 114 each tier carries its
    -- own base inside its own block, and that is the one to convert with.
    'base_currency', p.base_currency,
    'stock', p.stock_opening,
    'wholesale_min_quantity', p.wholesale_min_quantity,
    -- BOTH TIERS WHOLE, and the screen decides. An unpublished tier travels as
    -- null and is shown nowhere.
    --
    -- EACH TIER CARRIES ITS BASE AND ITS CURRENCY LIST (114). The block is
    -- self-contained on purpose: a caller that has the block has everything
    -- it needs to price it, so there is no way to convert a wholesale price
    -- with the retail base by reaching for the wrong variable.
    'retail', case
      when p.published_retail and p.price_retail is not null
      then json_build_object(
        'price', p.price_retail,
        'pinned', coalesce(v_retail_pinned, '{}'::json),
        'base_currency', p.base_currency_retail,
        'currencies', public.product_catalog_currencies(p.id, 'retail', p.base_currency_retail)
      )
      else null end,
    'wholesale', case
      when p.published_wholesale and p.price_wholesale is not null
      then json_build_object(
        'price', p.price_wholesale,
        'pinned', coalesce(v_wholesale_pinned, '{}'::json),
        'base_currency', p.base_currency_wholesale,
        'currencies', public.product_catalog_currencies(p.id, 'wholesale', p.base_currency_wholesale)
      )
      else null end,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

revoke execute on function public.get_shared_product(text, uuid) from public;
grant execute on function public.get_shared_product(text, uuid) to anon, authenticated;

-- ===========================================================================
-- 6. THE PRODUCTS IN A CART
-- ===========================================================================

drop function if exists public.get_shared_products(text, uuid[]);

create function public.get_shared_products(p_token text, p_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  v_products json;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  -- A CAP HERE TOO. The cart takes 50 lines (migration 109) and this function
  -- can be called by anyone holding the link: with no limit, a request with
  -- ten thousand ids would be an expensive query for free.
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) > 50 then
    return json_build_object('products', '[]'::json);
  end if;

  select country into v_country from public.owners where id = v_owner_id;

  select json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'photo_path', p.photo_path,
      -- The product's default base; each tier's own is inside its block.
      'base_currency', p.base_currency,
      'stock', p.stock_opening,
      'wholesale_min_quantity', p.wholesale_min_quantity,
      -- BOTH TIERS WHOLE, same as `get_shared_product`. An unpublished tier
      -- travels as null and is shown nowhere.
      'retail', case
        when p.published_retail and p.price_retail is not null
        then json_build_object(
          'price', p.price_retail,
          'pinned', coalesce(ret.pinned, '{}'::json),
          'base_currency', p.base_currency_retail,
          'currencies', public.product_catalog_currencies(p.id, 'retail', p.base_currency_retail)
        )
        else null end,
      'wholesale', case
        when p.published_wholesale and p.price_wholesale is not null
        then json_build_object(
          'price', p.price_wholesale,
          'pinned', coalesce(may.pinned, '{}'::json),
          'base_currency', p.base_currency_wholesale,
          'currencies', public.product_catalog_currencies(p.id, 'wholesale', p.base_currency_wholesale)
        )
        else null end
    ) order by p.name asc
  )
  into v_products
  from public.products p
  left join lateral (
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = 'retail'
  ) ret on true
  left join lateral (
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = 'wholesale'
  ) may on true
  where p.id = any(p_ids)
    and p.owner_id = v_owner_id
    and p.trashed_at is null
    and (p.published_retail or p.published_wholesale);

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'owner_country', v_country,
    'products', coalesce(v_products, '[]'::json),
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

revoke execute on function public.get_shared_products(text, uuid[]) from public;
grant execute on function public.get_shared_products(text, uuid[]) to anon, authenticated;

-- ===========================================================================
-- 7. THE ORDER, WITH THE TIER'S BASE
--
-- Taken from migration 113 and given five edits: a `v_base` declaration, the
-- read right after the tier is decided, and three sites that used
-- `p.base_currency`. The file was GENERATED by extracting 113's function and
-- patching it, then asserting that no `p.base_currency` survives in its code
-- -- because on 2026-10-15 retyping this function from memory silently lost
-- `normalize_whatsapp_phone` and renamed six error codes.
-- ===========================================================================

drop function if exists public.create_catalog_order(text, text, text, text, boolean, text, jsonb);

create function public.create_catalog_order(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  -- The literal sentence the checkbox had on screen. It is THE evidence for
  -- Meta, same rule as every other consent: two different texts turn the proof
  -- into a reconstruction.
  p_consent_text text,
  -- [{ "product_id": uuid, "quantity": number, "currency": text,
  --    "comment": text|null }]
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- THE CAPS, TOGETHER AND AT THE TOP so they can be seen at a glance and
  -- changed in one place. The numbers have reasons; they are not round for
  -- the sake of it:
  --
  --   50 lines: a real corner-shop order does not pass ten. Fifty leaves room
  --   to spare and cuts off a megabyte-sized request.
  --
  --   20 per minute per link: a script does thousands a minute and a shop does
  --   not do twenty. The limit tells the two apart by their SHAPE, not by
  --   their volume, which is what stops it blocking a real customer. Watching
  --   it is `CT-68`, because setting it too low costs sales and says nothing.
  c_max_lineas constant int := 50;
  c_max_por_minuto constant int := 20;

  v_owner_id uuid;
  v_link_id uuid;
  v_recientes int;
  v_phone text;
  v_nombre text;
  v_documento text;
  v_order_id uuid;
  v_item jsonb;
  v_n_items int;

  p public.products%rowtype;
  v_cantidad numeric;
  v_moneda text;
  v_tier text;
  -- THE TIER'S BASE (114). It is read once, right after the tier is decided,
  -- and every line below uses THIS and never `p.base_currency` -- which since
  -- 114 is only the product's default and prices nothing.
  v_base text;
  v_precio numeric;
  v_fijado numeric;
  v_min numeric;

  -- WHAT THE CONVERSION NEEDS, new in migration 111.
  v_monedas json;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_rate_usd numeric;
  v_rate_eur numeric;
  -- NEW IN 113. It does not come from `get_current_bcv_rate()` like the other
  -- two: the USDT price is not published by the central bank, it is scraped
  -- from CriptoYa and stored by migration 112.
  v_rate_usdt numeric;
  v_bs_base numeric;
  v_bs_destino numeric;
begin
  -- ── PADLOCK 1: the owner comes from the TOKEN ─────────────────────────
  select owner_id, id into v_owner_id, v_link_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    -- The same "no" for a token that never existed and one that was revoked,
    -- like every other public surface: anyone trying tokens at random learns
    -- nothing from the difference.
    return jsonb_build_object('ok', false, 'reason', 'enlace_invalido');
  end if;

  -- ── PADLOCK 4: cap per link, per minute ───────────────────────────────
  select count(*) into v_recientes
  from public.catalog_orders
  where catalog_link_id = v_link_id
    and created_at > now() - interval '1 minute';

  if v_recientes >= c_max_por_minuto then
    return jsonb_build_object('ok', false, 'reason', 'demasiadas_ordenes');
  end if;

  -- ── Who is ordering ───────────────────────────────────────────────────
  v_nombre := btrim(coalesce(p_customer_name, ''));
  v_documento := btrim(coalesce(p_customer_document, ''));

  if v_nombre = '' or length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;

  if v_documento = '' or length(v_documento) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'documento_invalido');
  end if;

  -- Normalised HERE and never by the caller, which is the same rule as the
  -- rest of the product: the phone is the key of the consent, and two
  -- spellings of the same number are two different people to the database.
  v_phone := public.normalize_whatsapp_phone(p_customer_whatsapp);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'whatsapp_invalido');
  end if;

  -- ── PADLOCK 3: size ───────────────────────────────────────────────────
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;

  v_n_items := jsonb_array_length(p_items);
  if v_n_items = 0 then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;
  if v_n_items > c_max_lineas then
    return jsonb_build_object('ok', false, 'reason', 'demasiados_productos');
  end if;

  -- ── THE SHOP'S RATE, ONCE FOR THE WHOLE ORDER (111) ───────────────────
  --
  -- Outside the loop on purpose: with the rate read per line, a twelve-product
  -- order could cross the cron refresh halfway through and end up holding two
  -- different rates inside it. A quote with two rates cannot be explained to
  -- anybody.
  --
  -- SAME RULE AS THE SCREEN, which builds it in `app/c/[token]/page.tsx`: if
  -- the shop set its own rate and has both, that one wins; otherwise the BCV
  -- one. The two have to agree, or the customer would see one number and the
  -- order would store another BY DESIGN, not by drift.
  select country into v_country from public.owners where id = v_owner_id;
  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    if v_settings.rate_mode = 'CUSTOM'
       and v_settings.custom_rate_usd is not null and v_settings.custom_rate_usd > 0
       and v_settings.custom_rate_eur is not null and v_settings.custom_rate_eur > 0 then
      v_rate_usd := v_settings.custom_rate_usd;
      v_rate_eur := v_settings.custom_rate_eur;
    else
      select r.usd, r.eur into v_rate_usd, v_rate_eur from public.get_current_bcv_rate() r;
    end if;

    -- THE USDT RATE IS READ EVEN WHEN THE SHOP USES ITS OWN RATE, and that is
    -- deliberate. `rate_mode = 'CUSTOM'` lets a shopkeeper set their own
    -- bolivar rate for the dollar and the euro; it says nothing about the P2P
    -- price of the USDT, which is a market price and not theirs to set. The
    -- product form treats it the same way.
    --
    -- Null is the normal state when nobody has opened this catalogue in 24
    -- hours, and null means USDT is simply not offered -- same as before
    -- migration 112 existed. See `get_current_usdt_rate()` for why stale is
    -- treated as absent.
    v_rate_usdt := public.get_current_usdt_rate();
  end if;

  -- ── The order ─────────────────────────────────────────────────────────
  insert into public.catalog_orders (
    owner_id, catalog_link_id,
    customer_name, customer_document,
    customer_whatsapp, customer_whatsapp_raw,
    wants_whatsapp_notices
  )
  values (
    v_owner_id, v_link_id,
    v_nombre, v_documento,
    v_phone, btrim(coalesce(p_customer_whatsapp, '')),
    coalesce(p_wants_notices, false)
  )
  returning id into v_order_id;

  -- ── The lines, one by one ─────────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- PADLOCK 2: the product belongs to THIS owner, is not in the bin and is
    -- published. Any old id pasted into the request does not get in.
    select * into p
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and owner_id = v_owner_id
      and trashed_at is null
      and (published_retail or published_wholesale);

    if not found then
      -- The whole order is undone. Half an order is worse than none: the
      -- shopkeeper would serve a request missing what the customer believed
      -- they had ordered, with nothing saying so.
      raise exception 'producto_invalido' using errcode = 'P0001';
    end if;

    v_cantidad := (v_item ->> 'quantity')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 99999999999 then
      raise exception 'cantidad_invalida' using errcode = 'P0001';
    end if;

    -- THE TIER, under the same rule as `escalonParaCantidad`. See the header:
    -- this is where it is DECIDED, the TypeScript only displays it.
    --
    -- With no minimum quantity the wholesale tier is NEVER reached, and that
    -- is the safe side: a wholesale price charged for one unit is money lost.
    -- Migration 088 permits the null and documents the opposite reading; it is
    -- discarded here on purpose.
    v_min := p.wholesale_min_quantity;
    if not (p.published_retail and p.price_retail is not null) then
      v_tier := 'wholesale';
    elsif not (p.published_wholesale and p.price_wholesale is not null) then
      v_tier := 'retail';
    elsif v_min is null then
      v_tier := 'retail';
    elsif v_cantidad >= v_min then
      v_tier := 'wholesale';
    else
      v_tier := 'retail';
    end if;

    -- THE MINIMUM IS A HARD BARRIER ONLY WHEN THERE IS NOWHERE TO FALL. A
    -- product sold only by wholesale has no retail price to drop to, so
    -- ordering less than the minimum means nothing. With both tiers published,
    -- ordering few does mean something: it is the retail price.
    if v_tier = 'wholesale'
       and not (p.published_retail and p.price_retail is not null)
       and v_min is not null and v_cantidad < v_min then
      raise exception 'cantidad_bajo_el_minimo' using errcode = 'P0001';
    end if;

    v_precio := case when v_tier = 'wholesale' then p.price_wholesale else p.price_retail end;
    if v_precio is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- THE BASE OF THE TIER THAT APPLIES, read next to the price it belongs to
    -- so the two cannot come from different tiers.
    v_base := case when v_tier = 'wholesale'
                   then p.base_currency_wholesale
                   else p.base_currency_retail end;
    if v_base is null then
      -- Impossible once 114 has run -- both columns are NOT NULL -- but a
      -- null base would convert against nothing and quote a wrong number, so
      -- it refuses instead of guessing.
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- PADLOCK 5: THIS function computes the amount, and the price NEVER
    -- travels in the request. That does not change. What changed on
    -- 2026-10-15 is where the number comes from -- the product record, or the
    -- product record plus the rate -- and the cost of that change is measured
    -- in this migration's header.
    v_moneda := upper(btrim(coalesce(v_item ->> 'currency', '')));

    -- FIRST: the currency has to be one this product actually sells in.
    -- Without this check any convertible currency would do -- a customer could
    -- order in euros a product the shopkeeper only sells in dollars, and the
    -- conversion would work perfectly.
    --
    -- PINNED PRICES COUNT EVEN WHEN THEY ARE NOT IN `product_currencies`, and
    -- this is not a belt-and-braces: without it migration 111 would BREAK
    -- products that work today. Migration 087 only carried `base_currency`
    -- over to that table (`select id, base_currency from products`), so a
    -- product not re-saved since then holds ONE enabled currency even when it
    -- carries pinned prices in others. A price pinned for a tier is the
    -- strongest possible statement that the product sells in that currency:
    -- the shopkeeper typed it by hand.
    --
    -- `qa:orden` 3a catches it, using a freshly created product -- no rows in
    -- `product_currencies` and the euro pinned at wholesale.
    v_monedas := public.product_catalog_currencies(p.id, v_tier, v_base);
    if v_moneda <> v_base
       and not exists (
         select 1 from json_array_elements_text(v_monedas) m where m.value = v_moneda
       )
       and not exists (
         select 1 from public.product_price_overrides o
         where o.product_id = p.id and o.tier = v_tier and o.currency = v_moneda
       )
    then
      raise exception 'moneda_invalida' using errcode = 'P0001';
    end if;

    -- THE SAME ORDER AS `priceIn` IN TYPESCRIPT: pinned by hand, then the
    -- base, then the conversion. The order matters and is not the intuitive
    -- one -- a pinned price wins EVEN over the base, because a closed padlock
    -- is an explicit decision by the shopkeeper and the base is the starting
    -- value.
    select amount into v_fijado
    from public.product_price_overrides
    where product_id = p.id and tier = v_tier and currency = v_moneda;

    if found and v_fijado is not null and v_fijado > 0 then
      v_precio := v_fijado;
    elsif v_moneda <> v_base then
      -- BOLIVARES PER UNIT OF EACH CURRENCY, same as `bolivaresPorUnidad`.
      --
      -- USDT JOINED THE LIST IN 113. Until then it was deliberately left out
      -- because its rate was stored nowhere, so every USDT order was rejected
      -- with `sin_tasa` unless the shopkeeper had pinned the price by hand.
      -- Migration 112 stores it, and `v_rate_usdt` is null exactly when it is
      -- missing or stale -- so the old behaviour is still what happens then,
      -- through the same branch, rather than through a special case.
      --
      -- COP IS STILL OUT, and that is not an omission: there is no
      -- bolivar/peso rate anywhere in the product and none is invented. A
      -- Colombian shop sells in its own currency and converts nothing.
      v_bs_base := case v_base
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;
      v_bs_destino := case v_moneda
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;

      if v_bs_base is null or v_bs_destino is null then
        -- A NEW REASON, DISTINCT FROM `moneda_invalida` ON PURPOSE. "We do not
        -- sell it in that currency" and "we do sell it but right now we have
        -- no rate" are two problems with two different fixes: the first the
        -- shopkeeper fixes by enabling the currency, the second fixes itself
        -- or is a fault of ours. One reason for both makes them
        -- indistinguishable in the log, which is where they get diagnosed.
        raise exception 'sin_tasa' using errcode = 'P0001';
      end if;

      -- TWO DECIMALS, ordinary rounding, same as `redondear` in price.ts.
      --
      -- CAREFUL, THE ARITHMETIC IS NOT THE SAME: `numeric` here and 64-bit
      -- floating point in the browser. On an exact tie the two could part
      -- company on the last cent, and then the customer would see one number
      -- and the order would store another. Not observed; written down because
      -- if someone ever reports "it stored a cent too much", this is the cause
      -- to look at first, not the rate drift. `qa:orden` 14a/14b compare the
      -- two sides to the cent, and `CT-72` holds what they do not cover.
      v_precio := round((v_precio * v_bs_base) / v_bs_destino, 2);

      if v_precio <= 0 then
        raise exception 'sin_precio' using errcode = 'P0001';
      end if;
    end if;

    insert into public.catalog_order_items (
      order_id, product_id, product_name,
      quantity, unit_price, currency, tier, comment
    )
    values (
      v_order_id, p.id, p.name,
      v_cantidad, v_precio, v_moneda, v_tier,
      nullif(btrim(coalesce(left(v_item ->> 'comment', 500), '')), '')
    );
  end loop;

  -- ── The consent, if they asked for it ─────────────────────────────────
  --
  -- OWNER'S DECISION ON 2026-10-15, displacing the "exit A" the same owner had
  -- decided on 2026-10-14. The old reason stays written down because it is the
  -- one needed to revert: the consent is valid for ALL businesses (migration
  -- 081) and here the number is typed by an anonymous visitor, so anyone could
  -- sign up a third party's number.
  --
  -- What displaces it is that the shopkeeper now OPENS the order and verifies
  -- name, document and phone -- and can correct them -- before serving it.
  -- That is the double check that did not exist on the 14th.
  --
  -- The remaining risk, stated: the consent exists from the moment the box is
  -- ticked until the shopkeeper looks. In that window no message goes out by
  -- itself -- that number also has to be a client of some shop and have a
  -- movement registered -- but the window exists. That is why the source is
  -- `client_order` and not `client_self`: if they ever have to be found and
  -- revoked, this column is the only way.
  if coalesce(p_wants_notices, false) and btrim(coalesce(p_consent_text, '')) <> '' then
    insert into public.client_whatsapp_consents (phone, event, consent_text, source)
    values (v_phone, 'granted', btrim(p_consent_text), 'client_order');
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);

exception
  when sqlstate 'P0001' then
    -- The `raise` text is a stable code, not a sentence to display. The caller
    -- translates it; the public page NEVER shows raw text from the database,
    -- which is CLAUDE.md's rule about masking errors.
    --
    -- AND CATCHING IT HERE UNDOES THE WHOLE ORDER, which is the wanted
    -- behaviour: a block with an `exception` clause is a subtransaction, so
    -- entering here takes the already-inserted rows with it. Half an order is
    -- worse than none -- the shopkeeper would serve a request missing what the
    -- customer believed they had ordered, with nothing saying so.
    return jsonb_build_object('ok', false, 'reason', sqlerrm);

  when others then
    -- WHAT WE DID NOT FORESEE. A `product_id` that is not a uuid, a quantity
    -- that is not a number: things that do not come from a normal browser and
    -- that, without this, would surface as a raw Postgres error.
    --
    -- The caller gets a generic reason -- the masking rule -- and the real
    -- detail goes to the server log with `raise warning`, which is the only
    -- place we want to see it. Without the `warning`, this `when others` would
    -- swallow our own failures too and we would never know.
    raise warning 'create_catalog_order fallo inesperado: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$fn$;

revoke execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) from public;
grant execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) to anon, authenticated;

comment on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) is
  'Creates an order from the public catalogue. Called by an ANONYMOUS visitor. Five padlocks: the owner comes from the token and never from the browser; every product is validated as theirs, not trashed and published; size caps (50 lines, bounded texts); a cap of 20 orders per link per minute; and the PRICE is computed by this function, never travelling in the request. Since migration 114 the amount is converted with THE TIER base (base_currency_retail or base_currency_wholesale), never with products.base_currency, which prices nothing any more. The requested currency has to be that base, one enabled for that tier in product_currencies, or one pinned by hand for that tier. USDT converts from the price stored by migration 112 and falls back to sin_tasa when it is missing or stale; COP never converts. The tier is decided here under the same rule as lib/products/public-pricing.ts, and THIS one rules.';

insert into public.schema_migrations (key, description)
values (
  '114_cada_escalon_con_sus_monedas',
  'Cada escalon pasa a tener sus propias monedas Y su propia moneda base. Lo reporto el dueno el 2026-10-15: agregar o quitar una moneda en un escalon lo hacia en el otro. No era una regresion -- catalog-product-dialog.tsx siempre tuvo UNA sola lista `currencies` y le pasaba los mismos callbacks a las dos secciones -- y es el caso que el mismo planteo el 2026-10-14 y que la cabecera de la 111 dio por inexpresable, diciendo que haria falta una columna tier. Esta es esa columna y lo que la 111 no previo: una columna tier NO basta, porque products.base_currency era UNA sola columna con la unidad de price_retail Y price_wholesale, asi que "solo una moneda al mayor" solo valia si esa era aquella en la que se escribe el precio. Preguntado el 2026-10-15 con los dos casos escritos, el dueno eligio el segundo: el mayor tiene que poder ofrecerse en euros mientras el detal se sigue escribiendo en dolares. Por eso se tocan products -- la tabla con los precios reales -- y no solo el satelite. product_currencies pasa a clave (product_id, tier, currency); products gana base_currency_retail y base_currency_wholesale, NOT NULL y rellenadas, no "null = usa la otra": una reserva deja a un sitio de lectura olvidado pareciendo correcto para siempre. base_currency NO se borra, porque la rejilla del tendero, los filtros y la tarjeta la leen, pero deja de ser la unidad de ningun precio. El traspaso duplica las monedas de cada producto a los dos escalones y copia la base, asi que NADIE cambia de precio: la migracion sola no mueve nada, el riesgo esta en el codigo que la lee despues. El peligro concreto, por si aparece: una sola lectura olvidada cotizaria el mayor con la base del detal -- 6,01 dolares saliendo como 6,01 euros, un 8 % mas caro y perfectamente plausible.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. NOBODY CHANGED PRICE. Every product must have both new bases equal to
--    the old one, because the backfill copied it:
--
-- select count(*) as productos,
--        count(*) filter (where base_currency_retail = base_currency) as detal_igual,
--        count(*) filter (where base_currency_wholesale = base_currency) as mayor_igual
-- from public.products;
--
-- EXPECTED: the three numbers identical. Any gap means a product silently
-- changed the currency its price is written in.
--
-- 2. Every currency row exists for BOTH tiers, which is what keeps today's
--    catalogue showing exactly what it showed before:
--
-- select tier, count(*) from public.product_currencies group by tier order by tier;
--
-- EXPECTED: two rows, retail and wholesale, with the SAME count.
--
-- 3. The key is the triple now, so the same currency can live on one tier and
--    not the other:
--
-- select string_agg(a.attname, ', ' order by k.ord) as clave
-- from pg_constraint c
-- join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
-- join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
-- where c.conrelid = 'public.product_currencies'::regclass and c.contype = 'p';
--
-- EXPECTED: product_id, tier, currency.
--
-- 4. One version of each function, and the old two-argument helper is gone:
--
-- select p.proname, count(*) as versiones
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('get_shared_catalog', 'get_shared_product',
--                     'get_shared_products', 'create_catalog_order',
--                     'product_catalog_currencies')
-- group by p.proname order by p.proname;
--
-- EXPECTED: 1 for all five.
--
-- 5. And the order function no longer reads the product-level base anywhere:
--
-- select position('p.base_currency;' in prosrc) = 0
--    and position('<> p.base_currency ' in prosrc) = 0 as sin_base_de_producto
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_catalog_order';
--
-- EXPECTED: true.
