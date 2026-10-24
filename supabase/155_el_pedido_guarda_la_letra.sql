-- THE CATALOGUE ORDER KEEPS THE DOCUMENT'S LETTER TOO.
--
-- Asked for by the owner on 2026-10-24, right after the prefix reached every
-- other screen: *«Añade el selector en los pedidos del catálogo»*. Until now
-- `catalog_orders` stored the document as loose text with no type column,
-- because the public form never asked, so the order detail was the one place
-- that could not say «V-32.256.369».
--
-- ===========================================================================
-- THE SIGNATURE CHANGES, SO BOTH ARE DROPPED
--
-- Postgres overloads on argument types: `create or replace` would leave a
-- SECOND `create_catalog_order` and PostgREST would resolve calls to whichever
-- it liked. And dropping only the OLD one makes this file work exactly once --
-- on a second run the drop matches nothing and `create function` fails with
-- `42723`. So both go, which is the rule CLAUDE.md spells out and the reason
-- `047_admin_metrics_multi_owner` carries twelve drops for six functions.
--
-- ===========================================================================
-- THE LETTER IS DISCARDED, NEVER THE ORDER
--
-- A type that does not match the business's country ('NIT' from a Venezuelan
-- shop) is dropped to null and the order goes through. The letter is an
-- ornament of the document, not the document: refusing someone's purchase
-- over it would charge them for someone else's mistake. Same criterion
-- `isDocumentTypeFor` applies on the owner's two client-creation doors.
--
-- AND IT IS VALIDATED WHERE THE COUNTRY IS KNOWN, not up with the other field
-- checks. Written next to the document's own validation it read a `v_country`
-- that is assigned fifty-one lines LOWER -- always null, so every letter would
-- have been discarded, the form would have sent it, the order would have
-- saved, and nothing anywhere would have errored. The in-function comment says
-- so, because that is the kind of thing someone tidies back up.
--
-- ===========================================================================
-- THE COLUMN IS NULLABLE AND STAYS THAT WAY
--
-- Every order placed before today has no letter and there is none to infer:
-- nobody was asked. A default of 'V' would assert that a past customer is a
-- person rather than a company. The owner's screens already render a bare
-- number when the type is null.

-- ── 1. LA COLUMNA ───────────────────────────────────────────────────────
alter table public.catalog_orders
  add column if not exists customer_document_type text;

-- A CHECK AND NOT AN ENUM: the six values are the same list
-- `lib/document-id.ts` owns, and an enum would need its own migration the day
-- a third country shows up. `null` is always allowed -- see the header.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'catalog_orders_document_type_check'
  ) then
    alter table public.catalog_orders
      add constraint catalog_orders_document_type_check
      check (
        customer_document_type is null
        or customer_document_type in ('V', 'E', 'J', 'CC', 'CE', 'NIT')
      );
  end if;
end;
$$;

-- ── 2. LA FUNCIÓN ───────────────────────────────────────────────────────
--
-- LAS DOS FIRMAS: la de siete argumentos que existe hoy y la de ocho que crea
-- este archivo. Ver la cabecera.
drop function if exists public.create_catalog_order(text, text, text, text, boolean, text, jsonb);
drop function if exists public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb);

create function public.create_catalog_order(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  -- LA LETRA DEL DOCUMENTO: 'V'/'E'/'J' o 'CC'/'CE'/'NIT'. Opcional y
  -- validada contra el país del negocio más abajo -- un 'NIT' llegando de una
  -- bodega venezolana es un error o una petición escrita a mano, y en los dos
  -- casos se descarta en vez de guardarse. Es el mismo criterio que
  -- `isDocumentTypeFor` aplica en las dos altas de cliente del dueño.
  p_customer_document_type text,
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
  v_tipo_documento text;
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

  -- ── LA LETRA DEL DOCUMENTO, VALIDADA CONTRA EL PAÍS ──────────────────
  --
  -- AQUÍ Y NO ARRIBA CON EL RESTO DE LAS VALIDACIONES, y esto estuvo a punto
  -- de salir mal: `v_country` se lee en la línea de encima. Escrito junto a
  -- la comprobación del documento —51 líneas antes— leía NULL siempre, caía
  -- en la rama de país desconocido y descartaba TODAS las letras. El
  -- formulario habría mandado la V, la orden se habría guardado, y la letra
  -- no estaría; sin un solo error en ninguna parte.
  --
  -- SE DESCARTA EN SILENCIO SI NO CORRESPONDE AL PAÍS, y no se rechaza la
  -- orden: la letra es un adorno del documento, no el documento. Tumbar la
  -- compra de un cliente por eso sería cobrarle el error de otro. Es el mismo
  -- criterio que `isDocumentTypeFor` aplica en las dos altas del dueño.
  v_tipo_documento := nullif(btrim(coalesce(p_customer_document_type, '')), '');
  if v_tipo_documento is not null then
    if v_country = 'VE' and v_tipo_documento not in ('V', 'E', 'J') then
      v_tipo_documento := null;
    elsif v_country = 'CO' and v_tipo_documento not in ('CC', 'CE', 'NIT') then
      v_tipo_documento := null;
    elsif v_country is null then
      v_tipo_documento := null;
    end if;
  end if;
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
    customer_name, customer_document, customer_document_type,
    customer_whatsapp, customer_whatsapp_raw,
    wants_whatsapp_notices
  )
  values (
    v_owner_id, v_link_id,
    v_nombre, v_documento, v_tipo_documento,
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

-- `anon` TAMBIÉN, como hasta hoy: quien pide por el catálogo no tiene sesión.
-- Es la única escritura de Sevenz sin sesión detrás, y por eso toda su
-- validación vive dentro de la función. Ver `qa:orden`.
grant execute on function public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '155_el_pedido_guarda_la_letra',
  'catalog_orders guarda customer_document_type y create_catalog_order lo recibe, validado contra el país del negocio. El formulario público del catálogo pasa a ofrecer el selector V/E/J o CC/CE/NIT.'
)
on conflict (key) do nothing;
