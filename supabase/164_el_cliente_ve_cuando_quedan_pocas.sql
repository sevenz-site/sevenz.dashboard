-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh), then in PRODUCTION
-- (rabmiyqodnvnrwiartuj). Code second, as always: the two customer-facing
-- screens read the new key defensively, so the old code keeps working against
-- this function and the new code against the old one would simply never go
-- amber.
--
-- ===========================================================================
-- THE CUSTOMER SEES THE COUNT WHEN STOCK IS RUNNING LOW
--
-- Asked for by the owner on 2026-10-29: *«cuando un producto tiene disponible
-- =< que el número del aviso seteado (…) el card debe ser el card amarillo
-- (…) aplica también para el catálogo, pedidos, reportes, vista del
-- cliente»*.
--
-- ---------------------------------------------------------------------------
-- THIS REVERSES A DECISION OF HIS, AND THAT IS WHY THE REASON IS WRITTEN HERE
--
-- On 2026-10-15 he decided the customer never sees a count: *«dice si hay o no
-- hay, nunca cuánto»*. That was not a styling call — it closed a real
-- contradiction, where the catalogue card said «No disponible» while the
-- product page said «Disponible: 0» to someone deciding whether to order.
--
-- He reopened it on 2026-10-29, told exactly what it reversed, and chose to
-- show the figure. SCOPED TO THE AMBER BAND: between 1 and the threshold. Above
-- it the 2026-10-15 rule still holds and the customer reads a bare
-- «Disponible», so a stranger holding the link still cannot read the whole
-- inventory. And at zero the card still says «No disponible», which is what
-- keeps the contradiction above from coming back.
--
-- ---------------------------------------------------------------------------
-- WHY THE THRESHOLD TRAVELS AND THE DECISION DOES NOT
--
-- These functions could have returned a ready-made `low` boolean per product
-- and saved the page a comparison. They return the raw number instead, because
-- the rule that reads it lives in `lib/products/availability.ts` and is shared
-- with the shopkeeper's eight screens. Computing it in SQL for the customer and
-- in TypeScript for the owner is two copies of one rule — which is how
-- `get_open_charges_for_client` and `buildChargeLedger` drifted apart for
-- months (`CT-124`), crediting on-time payments to debts nobody had paid.
--
-- ONE SCALAR, NOT ONE PER ROW: the threshold belongs to the shop, not to the
-- product. Repeating it on every card would invite a future migration to make
-- it per-product by changing only one of the two functions.
--
-- WHAT IT EXPOSES, said out loud: anyone holding a catalogue link can now read
-- how many units are left of any product at or below the threshold. That is the
-- feature. What it still does not expose is the threshold's effect on anything
-- else, or any count above it.
--
-- NOTHING ELSE IN EITHER FUNCTION CHANGES. Both bodies are lifted verbatim from
-- migration `114`, which is where their current definitions live -- `get_shared_
-- catalog` is written in six files and only the last one counts.
--
-- RE-RUNNABLE: `drop function if exists` on the exact signature, which is
-- unchanged, then `create`. The grants are restated because the drop takes them
-- with it -- without those two lines every catalogue link 404s.
-- ===========================================================================

-- ===========================================================================
-- 1. THE CATALOGUE GRID
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
  -- NEW on 164: so the card can tell «running low» from «plenty».
  v_low_stock integer;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country, low_stock_threshold
    into v_business, v_logo_path, v_whatsapp, v_country, v_low_stock
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
    'low_stock_threshold', v_low_stock,
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

comment on function public.get_shared_catalog(text) is
  'The public catalogue behind a catalog_share_links token. Since 164 it also returns low_stock_threshold, the shop''s «avísame cuando queden N o menos», so a card can go amber with its count when a product is running low. Above that threshold the customer still reads a bare «Disponible» and never a number -- the owner''s decision of 2026-10-15, narrowed and not dropped on 2026-10-29.';

-- ===========================================================================
-- 2. THE PRODUCT PAGE
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
  -- NEW on 164: see the catalogue above; the two screens grade the same.
  v_low_stock integer;
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

  select business_name, country, low_stock_threshold
    into v_business, v_country, v_low_stock
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
    'low_stock_threshold', v_low_stock,
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

comment on function public.get_shared_product(text, uuid) is
  'One published product behind a catalogue token. Since 164 it also returns low_stock_threshold, for the same reason as get_shared_catalog: the card and the page have to grade the same product the same way, which is exactly what they failed to do before 2026-10-15.';

-- ===========================================================================
-- 3. THE LEDGER
-- ===========================================================================

insert into public.schema_migrations (key, description)
values (
  '164_el_cliente_ve_cuando_quedan_pocas',
  'El catálogo y la ficha del cliente devuelven low_stock_threshold, para que una tarjeta se ponga ámbar con su cifra cuando quedan pocas unidades. Decisión del dueño el 2026-10-29, que acota —no deroga— la del 2026-10-15 de no enseñarle nunca la cantidad: por encima del umbral sigue leyendo «Disponible» a secas, y en cero «No disponible».'
)
on conflict (key) do nothing;
