-- EL CATALOGO OFRECE LAS MONEDAS QUE EL TENDERO ACTIVO, NO LAS QUE FIJO A MANO.
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- EL FALLO: SE LE PREGUNTABA A LA TABLA EQUIVOCADA
--
-- Las cuatro funciones del catalogo construian la lista de monedas desde
-- `product_price_overrides`, que guarda SOLO los precios que el tendero
-- desvinculo y escribio a mano. Las monedas que el tendero ACTIVO en el
-- producto estan en `product_currencies` (migracion 087), y ninguna de las
-- cuatro la leia.
--
-- Son dos preguntas distintas y se hacia la equivocada:
--
--   `product_currencies`      -> «en que monedas vende este producto»
--   `product_price_overrides` -> «que precios escribio a mano»
--
-- Medido en dev el 2026-10-15 con el producto «Casco» (USD base): tres monedas
-- activas —USD, EUR, USDT—, cero precios fijados. El cliente veia UNA.
--
-- ===========================================================================
-- LAS MONEDAS SON DEL PRODUCTO, NO DEL ESCALON
--
-- `product_currencies` tiene clave `(product_id, currency)` y NO tiene columna
-- `tier`. Asi que la lista es la misma para detal y para mayor; lo que cambia
-- entre escalones es solo el IMPORTE.
--
-- Queda escrito porque el 2026-10-14 se decidio «solo las monedas del escalon
-- que aplica» sobre el caso que planteo el dueno —«al detal en dolares pero al
-- mayor en euros, USDT y dolares»— y ese caso el modelo de datos NO lo sabe
-- expresar. Quien quiera monedas distintas por escalon necesita antes una
-- columna `tier` en esa tabla; no es un ajuste de estas funciones.
--
-- ===========================================================================
-- LO QUE ESTO LE CUESTA AL CANDADO 5, DICHO ENTERO
--
-- La 109 cerraba asi: «no se convierte nada con la tasa -- la moneda pedida
-- tiene que ser la base o una fijada a mano, o se rechaza», y de ahi salia una
-- propiedad buena: el importe de una orden era EXACTO POR CONSTRUCCION, no
-- habia deriva posible entre lo que el cliente vio y lo que quedo escrito.
--
-- Esa propiedad se pierde hoy, a proposito y con el coste medido: para que el
-- euro se pueda PEDIR, esta funcion tiene que convertir. El importe pasa a
-- depender de la tasa del instante del envio, no del instante en que el
-- cliente lo mire. Si la tasa se mueve entremedias, el cliente vio EUR 40,91 y
-- la orden dice EUR 40,50.
--
-- Se acepta por tres razones, en orden de peso:
--
-- 1. **Es la misma deriva que ya tiene cada precio convertido del producto**,
--    incluida la ficha del propio tendero. No es una clase de riesgo nueva:
--    es la que el app ya tiene, llegando a un sitio mas.
-- 2. La tasa del BCV se refresca una vez al dia por cron, asi que la ventana
--    real son los segundos alrededor de ese refresco.
-- 3. El importe se CONGELA en `catalog_order_items.unit_price` al insertar.
--    Una orden es un presupuesto cerrado: abrirla tres dias despues ensena lo
--    que se pidio, no lo que costaria hoy.
--
-- EL CANDADO 5 SIGUE EN PIE EN LO QUE IMPORTA: el precio NO viaja en la
-- peticion. Del navegador llega `{product_id, quantity, currency, comment}` y
-- nada mas. Lo unico que cambia es de donde sale el numero —de la ficha, o de
-- la ficha mas la tasa—, nunca quien lo decide.
--
-- ===========================================================================
-- EL USDT NO SE PUEDE PEDIR SI NO ESTA FIJADO, Y ESO ES COHERENTE A PROPOSITO
--
-- `get_current_bcv_rate()` da usd y eur. La tasa del USDT viene de CriptoYa,
-- un tercero, y el 2026-10-10 el dueno decidio que las paginas publicas no lo
-- llamaran en cada carga: en el catalogo `usdt` llega siempre null.
--
-- Consecuencia: aqui el USDT no se convierte NUNCA. Un producto con USDT
-- activo y sin precio fijado se puede pedir en las demas monedas, no en esa.
--
-- Y ES LO MISMO QUE DECIDE LA PANTALLA, que no ofrece una moneda sin numero.
-- Que las dos coincidan no es casualidad ni redundancia: es la unica forma de
-- que lo ofrecido y lo aceptado sean el mismo conjunto. Si algun dia se
-- enciende la tasa del USDT en el catalogo, hay que encenderla EN LOS DOS
-- SITIOS O EN NINGUNO -- encenderla solo en la pantalla ofrece algo que esta
-- funcion rechaza, y el cliente se come un `moneda_invalida` despues de
-- rellenar todo el formulario.

begin;

-- ===========================================================================
-- 0. LA LISTA DE MONEDAS, EN UN SOLO SITIO
--
-- Las cuatro funciones necesitan la misma lista con la misma regla de reserva,
-- y cuatro copias de un `coalesce` es como tres de ellas acaban diciendo una
-- cosa y la cuarta otra. Esta es la unica definicion.
--
-- LA BASE ENTRA SIEMPRE, aunque no este en `product_currencies`. Hoy no puede
-- faltar —el formulario toma `base_currency` de la primera moneda activa— pero
-- si alguna fila quedara descuadrada, el resultado sin esto seria un producto
-- que no se puede pedir en SU PROPIA moneda. El `union` tambien quita el
-- duplicado del caso normal.
--
-- LA BASE VA PRIMERA en el orden, que es el que la pantalla usa para los
-- radios: es el precio que el tendero escribio, y las demas salieron de el.
-- ===========================================================================

-- `drop` + `create` Y NO `create or replace`, aunque la funcion sea nueva.
-- CLAUDE.md lo documenta con lo que costo: `create or replace` no puede
-- cambiar el tipo ni el nombre de un parametro, asi que el dia que esta firma
-- cambie crearia un SEGUNDO overload en vez de reemplazar, y PostgREST
-- resolveria al que le guste. Una sola firma existe antes y despues de este
-- archivo, asi que un solo `drop` lo deja re-ejecutable.
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

-- NO LA LLAMA NADIE DE FUERA. Vive para las cuatro funciones de abajo, que son
-- SECURITY DEFINER y por tanto pueden ejecutarla sin que anon tenga el permiso.
-- Supabase concede EXECUTE a anon y authenticated sobre toda funcion nueva del
-- esquema public, asi que se les nombra a proposito en vez de confiar en que
-- revocarle a `public` baste -- la 067 documenta el agujero que eso abrio.
revoke execute on function public.product_catalog_currencies(uuid, text) from public;
revoke execute on function public.product_catalog_currencies(uuid, text) from anon;
revoke execute on function public.product_catalog_currencies(uuid, text) from authenticated;

comment on function public.product_catalog_currencies(uuid, text) is
  'Las monedas en las que un producto se puede pedir desde el catalogo publico: las activas de product_currencies mas su base, que entra siempre. La base va primera. Es del PRODUCTO y no del escalon, porque product_currencies no tiene columna tier. Interna: solo la llaman las funciones SECURITY DEFINER del catalogo.';

-- ===========================================================================
-- 1. EL CATALOGO
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

  -- EL PRECIO DE UNA UNIDAD, no el mas bajo (migracion 107): la portada
  -- ensena lo que cuesta comprar uno, y el de mayor aparece en el detalle
  -- cuando la cantidad lo alcanza.
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
-- 2. EL DETALLE DE UN PRODUCTO
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

  -- OWNER Y PUBLICADO, porque `p_product_id` llega de la URL. Sin esto,
  -- cambiar el identificador en la barra de direcciones ensenaria el producto
  -- de otro negocio -- comprobado el 2026-10-14: devuelve null, como debe.
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
    -- LA LISTA ENTERA, una sola vez: vale para los dos escalones.
    'currencies', public.product_catalog_currencies(p.id, p.base_currency),
    'stock', p.stock_opening,
    'wholesale_min_quantity', p.wholesale_min_quantity,
    -- LOS DOS ESCALONES ENTEROS, y la pantalla decide. Un escalon sin
    -- publicar viaja como null y no se ensena en ninguna parte.
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
-- 3. LOS PRODUCTOS DE UN CARRITO
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

  -- UN TOPE AQUI TAMBIEN. El carrito admite 50 lineas (migracion 109) y esta
  -- funcion la llama cualquiera con el enlace: sin limite, una peticion con
  -- diez mil ids seria una consulta cara gratis.
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
      -- Los DOS escalones enteros, igual que `get_shared_product`. Un escalon
      -- sin publicar viaja como null y no se ensena en ninguna parte.
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
-- 4. LA ORDEN, QUE AHORA CONVIERTE
-- ===========================================================================

drop function if exists public.create_catalog_order(text, text, text, text, boolean, text, jsonb);

create function public.create_catalog_order(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  -- La frase literal que la casilla tenia en pantalla. Es LA evidencia ante
  -- Meta, misma regla que el resto de los permisos: dos textos distintos
  -- convierten la prueba en una reconstruccion.
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
  -- LOS TOPES, JUNTOS Y ARRIBA para que se vean de un vistazo y se cambien en
  -- un sitio. Los numeros tienen razon de ser, no son redondos por gusto:
  --
  --   50 lineas: un pedido de bodega real no pasa de diez. Cincuenta deja
  --   sitio de sobra y corta una peticion de megabytes.
  --
  --   20 por minuto y por enlace: un guion hace miles por minuto y una bodega
  --   no hace veinte. El limite distingue las dos cosas por su FORMA, no por
  --   su volumen, que es lo que evita bloquear a un cliente de verdad.
  --   Vigilarlo es `CT-68`, porque quedarse corto cuesta ventas y no avisa.
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

  -- LO QUE LA CONVERSION NECESITA, nuevo en la migracion 111.
  v_monedas json;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_rate_usd numeric;
  v_rate_eur numeric;
  v_bs_base numeric;
  v_bs_destino numeric;
begin
  -- ── CANDADO 1: el dueno sale del TOKEN ────────────────────────────────
  select owner_id, id into v_owner_id, v_link_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    -- El mismo «no» para un token inexistente y para uno revocado, igual que
    -- en el resto de las superficies publicas: quien pruebe tokens al azar no
    -- aprende nada de la diferencia.
    return jsonb_build_object('ok', false, 'reason', 'enlace_invalido');
  end if;

  -- ── CANDADO 4: tope por enlace y por minuto ───────────────────────────
  select count(*) into v_recientes
  from public.catalog_orders
  where catalog_link_id = v_link_id
    and created_at > now() - interval '1 minute';

  if v_recientes >= c_max_por_minuto then
    return jsonb_build_object('ok', false, 'reason', 'demasiadas_ordenes');
  end if;

  -- ── Quien pide ────────────────────────────────────────────────────────
  v_nombre := btrim(coalesce(p_customer_name, ''));
  v_documento := btrim(coalesce(p_customer_document, ''));

  if v_nombre = '' or length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;

  if v_documento = '' or length(v_documento) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'documento_invalido');
  end if;

  -- Normalizado AQUI y nunca por quien llama, que es la misma regla que el
  -- resto del producto: el telefono es la clave del permiso y dos formas de
  -- escribir el mismo numero son dos personas distintas para la base.
  v_phone := public.normalize_whatsapp_phone(p_customer_whatsapp);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'whatsapp_invalido');
  end if;

  -- ── CANDADO 3: tamano ─────────────────────────────────────────────────
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

  -- ── LA TASA DEL NEGOCIO, UNA SOLA VEZ PARA TODA LA ORDEN (111) ────────
  --
  -- Fuera del bucle a proposito: con la tasa leida por linea, una orden de
  -- doce productos podria cruzar el refresco del cron por la mitad y quedar
  -- con dos tasas distintas dentro. Un presupuesto con dos tasas no se le
  -- puede explicar a nadie.
  --
  -- MISMA REGLA QUE LA PANTALLA, que la arma en `app/c/[token]/page.tsx`: si
  -- el negocio fijo tasa propia y tiene las dos, esa manda; si no, la del BCV.
  -- Las dos tienen que coincidir, o el cliente veria un numero y la orden
  -- guardaria otro POR SISTEMA, no por deriva.
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

  -- ── La orden ──────────────────────────────────────────────────────────
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

  -- ── Las lineas, una por una ───────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- CANDADO 2: el producto es de ESTE dueno, no esta en la papelera y esta
    -- publicado. Un id cualquiera pegado en la peticion no entra.
    select * into p
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and owner_id = v_owner_id
      and trashed_at is null
      and (published_retail or published_wholesale);

    if not found then
      -- Se deshace la orden entera. Media orden es peor que ninguna: el
      -- tendero atenderia un pedido al que le falta lo que el cliente creia
      -- haber pedido, sin que nada lo diga.
      raise exception 'producto_invalido' using errcode = 'P0001';
    end if;

    v_cantidad := (v_item ->> 'quantity')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 99999999999 then
      raise exception 'cantidad_invalida' using errcode = 'P0001';
    end if;

    -- EL ESCALON, con la misma regla que `escalonParaCantidad`. Ver la
    -- cabecera: aqui es donde se DECIDE, el TypeScript solo lo ensena.
    --
    -- Sin cantidad minima NUNCA se llega al mayor, y es el lado seguro: un
    -- precio mayorista cobrado por una unidad es dinero perdido. La migracion
    -- 088 permite el nulo y documenta lo contrario; se descarta a proposito.
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

    -- EL MINIMO ES BARRERA SOLO CUANDO NO HAY DONDE CAER. Un producto que solo
    -- se vende al mayor no tiene precio de detal al que bajar, asi que pedir
    -- menos del minimo no significa nada. Con los dos escalones publicados,
    -- pedir poco si significa algo: es el precio al detal.
    if v_tier = 'wholesale'
       and not (p.published_retail and p.price_retail is not null)
       and v_min is not null and v_cantidad < v_min then
      raise exception 'cantidad_bajo_el_minimo' using errcode = 'P0001';
    end if;

    v_precio := case when v_tier = 'wholesale' then p.price_wholesale else p.price_retail end;
    if v_precio is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- CANDADO 5: el importe lo calcula ESTA funcion, y el precio NUNCA viaja
    -- en la peticion. Eso no cambia. Lo que cambio el 2026-10-15 es de donde
    -- sale el numero -- de la ficha, o de la ficha mas la tasa -- y el coste
    -- de ese cambio esta medido en la cabecera de esta migracion.
    v_moneda := upper(btrim(coalesce(v_item ->> 'currency', '')));

    -- PRIMERO: la moneda tiene que ser una en la que este producto se venda.
    -- Sin esta comprobacion cualquier moneda convertible valdria -- un cliente
    -- podria pedir en euros un producto que el tendero solo vende en dolares,
    -- y la conversion funcionaria perfectamente.
    --
    -- LAS FIJADAS A MANO CUENTAN, AUNQUE NO ESTEN EN `product_currencies`, y
    -- esto no es un cinturon: sin ello la migracion 111 ROMPERIA productos que
    -- hoy funcionan. La 087 solo traspaso `base_currency` a esa tabla
    -- (`select id, base_currency from products`), asi que un producto que no
    -- se haya vuelto a guardar desde entonces tiene UNA sola moneda activa
    -- aunque lleve precios fijados en otras. Un precio fijado para un escalon
    -- es la afirmacion mas fuerte que existe de que el producto se vende en
    -- esa moneda: lo escribio el tendero a mano.
    --
    -- Lo caza `qa:orden` 3a, que usa un producto recien creado -- sin filas en
    -- `product_currencies` y con el euro fijado al mayor.
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

    -- EL MISMO ORDEN QUE `priceIn` EN TYPESCRIPT: fijado a mano, luego la
    -- base, luego la conversion. El orden importa y no es el intuitivo -- un
    -- precio fijado gana INCLUSO sobre la base, porque un candado cerrado es
    -- una decision explicita del tendero y la base es el valor de partida.
    select amount into v_fijado
    from public.product_price_overrides
    where product_id = p.id and tier = v_tier and currency = v_moneda;

    if found and v_fijado is not null and v_fijado > 0 then
      v_precio := v_fijado;
    elsif v_moneda <> p.base_currency then
      -- BOLIVARES POR UNIDAD DE CADA MONEDA, igual que `bolivaresPorUnidad`.
      -- USDT y COP se quedan sin tasa a proposito: ver la cabecera.
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
        -- RAZON NUEVA Y DISTINTA DE `moneda_invalida`, A PROPOSITO. «No lo
        -- vendemos en esa moneda» y «lo vendemos pero ahora mismo no tenemos
        -- la tasa» son dos problemas con dos arreglos distintos: el primero lo
        -- arregla el tendero activando la moneda, el segundo se arregla solo o
        -- es una averia nuestra. Una sola razon para los dos los vuelve
        -- indistinguibles en el log, que es donde se diagnostican.
        raise exception 'sin_tasa' using errcode = 'P0001';
      end if;

      -- DOS DECIMALES, redondeo normal, igual que `redondear` en price.ts.
      --
      -- OJO, LA ARITMETICA NO ES LA MISMA: aqui es `numeric` y en el navegador
      -- es coma flotante de 64 bits. En un empate exacto las dos podrian
      -- separarse en el ultimo centimo, y entonces el cliente veria un numero
      -- y la orden guardaria otro. No se ha observado; se escribe porque si
      -- algun dia se reporta «me guardo un centimo de mas», esta es la causa
      -- a mirar primero y no la deriva de la tasa.
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

  -- ── El permiso, si lo pidio ───────────────────────────────────────────
  --
  -- DECISION DEL DUENO EL 2026-10-15, y desplaza la «salida A» que el mismo
  -- habia decidido el 2026-10-14. La razon vieja queda escrita porque es la
  -- que haria falta para revertir: el permiso vale para TODOS los negocios
  -- (migracion 081) y aqui el numero lo teclea un visitante anonimo, asi que
  -- cualquiera podria dar de alta el numero de un tercero.
  --
  -- Lo que lo desplaza es que el tendero ahora ABRE la orden y verifica
  -- nombre, documento y telefono —puede corregirlos— antes de atenderla. Esa
  -- es la doble verificacion que el 14 no existia.
  --
  -- El riesgo que queda, dicho: el permiso existe desde que se marca la
  -- casilla hasta que el tendero mira. En esa ventana no sale ningun mensaje
  -- por si solo —hace falta ademas que ese numero sea cliente de alguna bodega
  -- y que le registren un movimiento— pero la ventana existe. Por eso el
  -- origen es `client_order` y no `client_self`: si algun dia hay que
  -- encontrarlos y revocarlos, esta columna es la unica forma.
  if coalesce(p_wants_notices, false) and btrim(coalesce(p_consent_text, '')) <> '' then
    insert into public.client_whatsapp_consents (phone, event, consent_text, source)
    values (v_phone, 'granted', btrim(p_consent_text), 'client_order');
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);

exception
  when sqlstate 'P0001' then
    -- El texto del `raise` es un codigo estable, no una frase para ensenar.
    -- Quien llama lo traduce; la pagina publica NUNCA ensena texto crudo de la
    -- base, que es la regla de CLAUDE.md sobre enmascarar errores.
    --
    -- Y ATRAPARLO AQUI DESHACE LA ORDEN ENTERA, que es el comportamiento
    -- buscado: un bloque con `exception` es una subtransaccion, asi que al
    -- entrar aqui las filas ya insertadas se van. Media orden es peor que
    -- ninguna — el tendero atenderia un pedido al que le falta lo que el
    -- cliente creia haber pedido, sin que nada lo diga.
    return jsonb_build_object('ok', false, 'reason', sqlerrm);

  when others then
    -- LO QUE NO PREVIMOS. Un `product_id` que no es un uuid, una cantidad que
    -- no es un numero: cosas que no vienen de un navegador normal y que, sin
    -- esto, saldrian como un error crudo de Postgres.
    --
    -- Al que llama se le da una razon generica —regla de enmascarar errores—
    -- y el detalle real va al log del servidor con `raise warning`, que es el
    -- unico sitio donde queremos verlo. Sin el `warning`, este `when others`
    -- se tragaria tambien nuestros propios fallos y no lo sabriamos nunca.
    raise warning 'create_catalog_order fallo inesperado: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$fn$;

revoke execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) from public;
grant execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) to anon, authenticated;

comment on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) is
  'Crea una orden desde el catalogo publico. La llama un visitante ANONIMO. Cinco candados: el dueno sale del token y nunca del navegador; cada producto se valida como suyo, sin borrar y publicado; topes de tamano (50 lineas, textos acotados); tope de 20 ordenes por enlace y por minuto; y el PRECIO lo calcula esta funcion, nunca viaja en la peticion. La moneda pedida tiene que ser la base, una ACTIVA en product_currencies, o una con precio fijado a mano para ese escalon -- esta ultima cuenta porque la 087 solo traspaso base_currency a esa tabla; el importe es el fijado a mano para ese escalon si existe, si no la base, si no la conversion con la tasa del negocio -- mismo orden que priceIn en TypeScript. USDT y COP no se convierten porque no hay tasa: razon sin_tasa, distinta de moneda_invalida. El escalon lo decide esta funcion con la misma regla que lib/products/public-pricing.ts, y MANDA esta: la de TypeScript es presentacion.';

insert into public.schema_migrations (key, description)
values (
  '111_catalogo_ofrece_las_monedas_activas',
  'El catalogo publico ofrecia solo la moneda base del producto mas las que el tendero habia FIJADO a mano, porque las cuatro funciones leian product_price_overrides -- que guarda los precios desvinculados -- en vez de product_currencies, que es la lista de monedas activas (migracion 087). Medido en dev con el producto Casco: tres monedas activas, cero fijadas, el cliente veia una. La suposicion vivia en cuatro sitios y solo uno era visible: monedasDelEscalon no las ofrecia, precioUnitario devolvia null y la linea DESAPARECIA del carrito sin aviso, create_catalog_order rechazaba con moneda_invalida, y las tres funciones de lectura no exponian la tabla. Corrige ademas una premisa que el agente dio mal el 2026-10-14: se descarto convertir alegando que ensenaria un importe que el tendero nunca escribio, cuando el formulario del propio tendero (catalog-product-dialog.tsx:1393) ya le ensena exactamente esa conversion. Las monedas son del PRODUCTO y no del escalon: product_currencies no tiene columna tier, asi que el caso que el dueno planteo -- monedas distintas al detal y al mayor -- el modelo no lo sabe expresar. Coste aceptado: el candado 5 pierde la exactitud por construccion, porque convertir ata el importe a la tasa del instante del envio; es la misma deriva que ya tiene cada precio convertido del app, la ventana son los segundos del refresco diario del cron, y el importe se congela al insertar. El precio sigue sin viajar en la peticion, que es lo que el candado 5 protege de verdad. El USDT no se convierte -- su tasa viene de CriptoYa y las paginas publicas no la piden (decision del 2026-10-10) -- asi que solo se puede pedir en USDT con el precio fijado a mano, y la pantalla no ofrece una moneda sin numero: encender esa tasa hay que hacerlo en los dos sitios o en ninguno.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. El catalogo ya ofrece las tres monedas del Casco:
--
-- select p.name, public.product_catalog_currencies(p.id, p.base_currency) as monedas
-- from public.products p
-- where p.name = 'Casco';
--
-- EXPECTED: ["USD","EUR","USDT"] -- la base primera, las demas alfabeticas.
--
-- 2. Y llega dentro del detalle publico, por el token real del enlace:
--
-- select (public.get_shared_product(l.token, p.id) -> 'currencies') as monedas
-- from public.catalog_share_links l
-- join public.products p on p.owner_id = l.owner_id and p.name = 'Casco';
--
-- EXPECTED: lo mismo que el punto 1.
--
-- 3. Una sola version de cada funcion -- un segundo overload es el fallo que
--    documenta CLAUDE.md, y PostgREST resolveria al que le guste:
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
-- EXPECTED: 1 en las cinco.
--
-- 4. El ayudante NO lo puede llamar un visitante, y la orden SI:
--
-- select
--   has_function_privilege('anon', 'public.product_catalog_currencies(uuid, text)', 'execute') as anon_ayudante,
--   has_function_privilege('anon', 'public.create_catalog_order(text, text, text, text, boolean, text, jsonb)', 'execute') as anon_orden;
--
-- EXPECTED: anon_ayudante = false, anon_orden = true.
