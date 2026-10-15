-- THE CATALOGUE OFFERS THE CURRENCIES THE SHOPKEEPER ENABLED, NOT THE ONES
-- THEY PINNED BY HAND.
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- THE BUG: THE WRONG TABLE WAS BEING ASKED
--
-- All four catalogue functions built their currency list from
-- `product_price_overrides`, which holds ONLY the prices the shopkeeper
-- unlinked and typed by hand. The currencies they ENABLED on the product live
-- in `product_currencies` (migration 087), and not one of the four read it.
--
-- Two different questions, and the wrong one was being asked:
--
--   `product_currencies`      -> "which currencies does this product sell in"
--   `product_price_overrides` -> "which prices were typed by hand"
--
-- Measured in dev on 2026-10-15 with the product «Casco» (USD base): three
-- enabled currencies -- USD, EUR, USDT -- and zero pinned prices. The customer
-- saw ONE.
--
-- ===========================================================================
-- CURRENCIES BELONG TO THE PRODUCT, NOT TO THE TIER
--
-- `product_currencies` is keyed `(product_id, currency)` and has NO `tier`
-- column. So the list is the same for retail and wholesale; what changes
-- between tiers is only the AMOUNT.
--
-- Written down because on 2026-10-14 we decided "only the currencies of the
-- tier that applies" on the strength of the case the owner described -- «al
-- detal en dolares pero al mayor en euros, USDT y dolares» -- and the data
-- model cannot express that case at all. Anyone who wants per-tier currencies
-- needs a `tier` column on that table first; it is not a tweak to these
-- functions.
--
-- ===========================================================================
-- WHAT THIS COSTS PADLOCK 5, STATED IN FULL
--
-- Migration 109 closed it like this: "nothing is converted with the rate --
-- the requested currency has to be the base or one pinned by hand, or it is
-- rejected", and that bought a good property: an order's amount was EXACT BY
-- CONSTRUCTION, with no possible drift between what the customer saw and what
-- got written down.
--
-- That property is given up today, deliberately and with the cost measured:
-- for the euro to be ORDERABLE, this function has to convert. The amount now
-- depends on the rate at the instant of submission, not at the instant the
-- customer looked. If the rate moves in between, the customer saw EUR 40.91
-- and the order says EUR 40.50.
--
-- Accepted for three reasons, heaviest first:
--
-- 1. **It is the same drift every converted price in the app already has**,
--    including the shopkeeper's own product form. This is not a new class of
--    risk: it is the one the app already carries, reaching one more place.
-- 2. The BCV rate refreshes once a day by cron, so the real window is the few
--    seconds around that refresh.
-- 3. The amount is FROZEN into `catalog_order_items.unit_price` on insert. An
--    order is a closed quote: opening it three days later shows what was
--    ordered, not what it would cost today.
--
-- PADLOCK 5 STILL HOLDS WHERE IT MATTERS: the price does NOT travel in the
-- request. What arrives from the browser is `{product_id, quantity, currency,
-- comment}` and nothing else. All that changed is where the number comes from
-- -- the product record, or the product record plus the rate -- never who
-- decides it.
--
-- ===========================================================================
-- USDT CANNOT BE ORDERED UNLESS IT IS PINNED, AND THAT IS COHERENT ON PURPOSE
--
-- `get_current_bcv_rate()` gives usd and eur. The USDT rate comes from
-- CriptoYa, a third party, and on 2026-10-10 the owner decided public pages
-- must not call it on every load: in the catalogue `usdt` always arrives null.
--
-- Consequence: USDT is NEVER converted here. A product with USDT enabled and
-- no pinned price can be ordered in the other currencies, not in that one.
-- The owner confirmed that way out on 2026-10-15: the shopkeeper pins the USDT
-- price by hand. See `CT-73` for what neither option fixes -- nothing tells
-- the shopkeeper their customer cannot see it.
--
-- AND THE SCREEN DECIDES THE SAME THING -- it does not offer a currency with
-- no number. The two agreeing is neither coincidence nor redundancy: it is the
-- only way for what is offered and what is accepted to be the same set. If the
-- USDT rate is ever switched on for the catalogue, it must be switched on IN
-- BOTH PLACES OR NEITHER -- switching it on only in the screen offers
-- something this function rejects, and the customer eats a `sin_tasa` after
-- filling in the whole form.

begin;

-- ===========================================================================
-- 0. THE CURRENCY LIST, IN ONE PLACE
--
-- All four functions need the same list under the same fallback rule, and four
-- copies of a `coalesce` is how three of them end up saying one thing and the
-- fourth another. This is the only definition.
--
-- THE BASE ALWAYS COUNTS, even when it is not in `product_currencies`. Today
-- it cannot be missing -- the form takes `base_currency` from the first
-- enabled currency -- but if a row ever went out of step, the result without
-- this would be a product that cannot be ordered in ITS OWN currency. The
-- `union` also removes the duplicate in the normal case.
--
-- THE BASE COMES FIRST in the ordering, which is the one the screen uses for
-- its radios: it is the price the shopkeeper typed, and the rest derive from
-- it.
-- ===========================================================================

-- `drop` + `create` AND NOT `create or replace`, even though the function is
-- new. CLAUDE.md documents what that cost: `create or replace` cannot change a
-- parameter's type or name, so the day this signature changes it would create
-- a SECOND overload instead of replacing, and PostgREST would resolve to
-- whichever it liked. One signature exists before and after this file, so a
-- single `drop` leaves it re-runnable.
drop function if exists public.product_catalog_currencies(uuid, text);

create function public.product_catalog_currencies(p_product_id uuid, p_base text)
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
    where c.product_id = p_product_id
  ) x
$$;

-- NOBODY OUTSIDE CALLS IT. It exists for the four functions below, which are
-- SECURITY DEFINER and can therefore execute it without anon holding the
-- privilege. Supabase grants EXECUTE to anon and authenticated on every new
-- function in the public schema, so they are named explicitly instead of
-- trusting that revoking from `public` is enough -- migration 067 documents
-- the real hole that assumption opened.
revoke execute on function public.product_catalog_currencies(uuid, text) from public;
revoke execute on function public.product_catalog_currencies(uuid, text) from anon;
revoke execute on function public.product_catalog_currencies(uuid, text) from authenticated;

comment on function public.product_catalog_currencies(uuid, text) is
  'The currencies a product can be ordered in from the public catalogue: the enabled ones in product_currencies plus its base, which always counts. The base comes first. It belongs to the PRODUCT and not to the tier, because product_currencies has no tier column. Internal: only the catalogue SECURITY DEFINER functions call it.';

-- ===========================================================================
-- 1. THE CATALOGUE
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
      'base_currency', p.base_currency,
      'currencies', public.product_catalog_currencies(p.id, p.base_currency),
      'stock', p.stock_opening,
      'price', pr.amount,
      'tier', pr.tier,
      'pinned', coalesce(ov.pinned, '{}'::json)
    ) order by p.name asc
  )
  into v_products
  from public.products p
  join lateral (
    select c.tier, c.amount
    from (
      select 'retail'::text as tier, p.price_retail as amount, 1 as prioridad
      where p.published_retail and p.price_retail is not null
      union all
      select 'wholesale'::text, p.price_wholesale, 2
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
-- 2. A PRODUCT'S DETAIL
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
    'base_currency', p.base_currency,
    -- THE WHOLE LIST, once: it serves both tiers.
    'currencies', public.product_catalog_currencies(p.id, p.base_currency),
    'stock', p.stock_opening,
    'wholesale_min_quantity', p.wholesale_min_quantity,
    -- BOTH TIERS WHOLE, and the screen decides. An unpublished tier travels as
    -- null and is shown nowhere.
    'retail', case
      when p.published_retail and p.price_retail is not null
      then json_build_object('price', p.price_retail, 'pinned', coalesce(v_retail_pinned, '{}'::json))
      else null end,
    'wholesale', case
      when p.published_wholesale and p.price_wholesale is not null
      then json_build_object('price', p.price_wholesale, 'pinned', coalesce(v_wholesale_pinned, '{}'::json))
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
-- 3. THE PRODUCTS IN A CART
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
      'base_currency', p.base_currency,
      'currencies', public.product_catalog_currencies(p.id, p.base_currency),
      'stock', p.stock_opening,
      'wholesale_min_quantity', p.wholesale_min_quantity,
      -- BOTH TIERS WHOLE, same as `get_shared_product`. An unpublished tier
      -- travels as null and is shown nowhere.
      'retail', case
        when p.published_retail and p.price_retail is not null
        then json_build_object('price', p.price_retail, 'pinned', coalesce(ret.pinned, '{}'::json))
        else null end,
      'wholesale', case
        when p.published_wholesale and p.price_wholesale is not null
        then json_build_object('price', p.price_wholesale, 'pinned', coalesce(may.pinned, '{}'::json))
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
-- 4. THE ORDER, WHICH NOW CONVERTS
--
-- Taken VERBATIM from migration 109 and given exactly three changes: the rate
-- lookup, the currency check, and the conversion branch. It was rewritten from
-- memory the first time round and that silently swapped
-- `normalize_whatsapp_phone` for a hand-rolled `regexp_replace` -- the phone
-- is the key of the WhatsApp consent, so two spellings of the same number are
-- two different people to the database. `qa:orden` caught it; no amount of
-- re-reading had.
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
  v_precio numeric;
  v_fijado numeric;
  v_min numeric;

  -- WHAT THE CONVERSION NEEDS, new in migration 111.
  v_monedas json;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_rate_usd numeric;
  v_rate_eur numeric;
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
    v_monedas := public.product_catalog_currencies(p.id, p.base_currency);
    if v_moneda <> p.base_currency
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
    elsif v_moneda <> p.base_currency then
      -- BOLIVARES PER UNIT OF EACH CURRENCY, same as `bolivaresPorUnidad`.
      -- USDT and COP are left without a rate on purpose: see the header.
      v_bs_base := case p.base_currency
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        else null end;
      v_bs_destino := case v_moneda
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
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
  'Creates an order from the public catalogue. Called by an ANONYMOUS visitor. Five padlocks: the owner comes from the token and never from the browser; every product is validated as theirs, not trashed and published; size caps (50 lines, bounded texts); a cap of 20 orders per link per minute; and the PRICE is computed by this function, never travelling in the request. The requested currency has to be the base, one enabled in product_currencies, or one with a price pinned by hand for that tier -- the last counts because migration 087 only carried base_currency over to that table; the amount is the pinned one for that tier if it exists, else the base, else the conversion with the shop rate -- same order as priceIn in TypeScript. USDT and COP are not converted because there is no rate: reason sin_tasa, distinct from moneda_invalida. The tier is decided by this function under the same rule as lib/products/public-pricing.ts, and THIS one rules: the TypeScript is presentation.';

insert into public.schema_migrations (key, description)
values (
  '111_catalogo_ofrece_las_monedas_activas',
  'El catalogo publico ofrecia solo la moneda base del producto mas las que el tendero habia FIJADO a mano, porque las cuatro funciones leian product_price_overrides -- que guarda los precios desvinculados -- en vez de product_currencies, que es la lista de monedas activas (migracion 087). Medido en dev con el producto Casco: tres monedas activas, cero fijadas, el cliente veia una. La suposicion vivia en cuatro sitios y solo uno era visible: monedasDelEscalon no las ofrecia, precioUnitario devolvia null y la linea DESAPARECIA del carrito sin aviso, create_catalog_order rechazaba con moneda_invalida, y las tres funciones de lectura no exponian la tabla. Corrige ademas una premisa que el agente dio mal el 2026-10-14: se descarto convertir alegando que ensenaria un importe que el tendero nunca escribio, cuando el formulario del propio tendero (catalog-product-dialog.tsx:1393) ya le ensena exactamente esa conversion. Las monedas son del PRODUCTO y no del escalon: product_currencies no tiene columna tier, asi que el caso que el dueno planteo -- monedas distintas al detal y al mayor -- el modelo no lo sabe expresar. El conjunto que se ofrece y el que se acepta es el mismo en los dos lados: base, activas, y las fijadas a mano para ese escalon -- estas ultimas cuentan porque la 087 solo traspaso base_currency, asi que sin ellas este arreglo habria roto productos que funcionan. Coste aceptado: el candado 5 pierde la exactitud por construccion, porque convertir ata el importe a la tasa del instante del envio; es la misma deriva que ya tiene cada precio convertido del app, la ventana son los segundos del refresco diario del cron, y el importe se congela al insertar. El precio sigue sin viajar en la peticion, que es lo que el candado 5 protege de verdad. El USDT no se convierte -- su tasa viene de CriptoYa y las paginas publicas no la piden (decision del 2026-10-10) -- asi que solo se puede pedir en USDT con el precio fijado a mano, que es la salida que el dueno confirmo el 2026-10-15; ver CT-73.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. The catalogue now offers all three of the Casco's currencies:
--
-- select p.name, public.product_catalog_currencies(p.id, p.base_currency) as monedas
-- from public.products p
-- where p.name = 'Casco';
--
-- EXPECTED: ["USD","EUR","USDT"] -- base first, the rest alphabetical.
--
-- 2. And it arrives inside the public detail, through the link's real token:
--
-- select (public.get_shared_product(l.token, p.id) -> 'currencies') as monedas
-- from public.catalog_share_links l
-- join public.products p on p.owner_id = l.owner_id and p.name = 'Casco';
--
-- EXPECTED: the same as point 1.
--
-- 3. One version of each function -- a second overload is the failure CLAUDE.md
--    documents, and PostgREST would resolve to whichever it liked:
--
-- select p.proname, count(*) as versiones
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('get_shared_catalog', 'get_shared_product',
--                     'get_shared_products', 'create_catalog_order',
--                     'product_catalog_currencies')
-- group by p.proname
-- order by p.proname;
--
-- EXPECTED: 1 for all five.
--
-- 4. The helper is NOT callable by a visitor, and the order IS:
--
-- select
--   has_function_privilege('anon', 'public.product_catalog_currencies(uuid, text)', 'execute') as anon_ayudante,
--   has_function_privilege('anon', 'public.create_catalog_order(text, text, text, text, boolean, text, jsonb)', 'execute') as anon_orden;
--
-- EXPECTED: anon_ayudante = false, anon_orden = true.
