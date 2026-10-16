-- ENVIRONMENT: run in DEV ONLY for now — dev branch (vzqppwrwnmlbrxizskdh).
-- Production (rabmiyqodnvnrwiartuj) does not have the catalogue yet: it is
-- missing 083 to 090 and 103. This goes with them, in order, the day el
-- catalogo se lance.
--
-- EL DETALLE DE UN PRODUCTO PARA EL CLIENTE FINAL. Entregable B del frame
-- 1192:4185.
--
-- ===========================================================================
-- UNA FUNCION NUEVA Y NO UN CAMPO MAS EN `get_shared_catalog`
--
-- La de la lista devuelve UN precio por producto —el del escalon del enlace—
-- y eso es lo correcto para una rejilla. El detalle necesita los DOS escalones
-- con sus monedas, el stock y el minimo, y multiplicar eso por cada producto
-- de la lista seria pagarlo en cada carga de una pantalla que no lo usa.
--
-- Y hay una razon mas fuerte: `get_shared_catalog` la llama una pagina que ya
-- esta en produccion el dia que el catalogo salga. Cambiarle la forma es la
-- clase de cosa que CLAUDE.md pide evitar —el 2026-09-04 anadir un argumento a
-- `get_shared_balance` habria 404eado todos los enlaces— y una funcion nueva no
-- puede romper la que ya funciona.
--
-- ===========================================================================
-- QUE ESCALON SE ENSEÑA LO DECIDE LA CANTIDAD, NO EL ENLACE
--
-- Decision del dueno el 2026-10-14, y CORRIGE EL FRAME. El frame dibuja los
-- dos bloques de precio juntos —«Precio al detal» y «Precio al mayor»— y el
-- dueno lo descarto con el caso concreto: si el detal son 5 dolares y el mayor
-- tiene euros, USDT y dolares a partir de 6 unidades, entonces pedir 3 ensena
-- las monedas del detal y pedir 6 ensena las del mayor. **Uno o el otro, nunca
-- los dos.**
--
-- Por eso esta funcion devuelve los dos bloques enteros y NO decide cual: la
-- cantidad la elige el cliente mientras mira la pantalla, asi que decidirlo
-- aqui obligaria a una llamada por cada toque del «+». La pantalla lo resuelve
-- en el navegador, sin red.
--
-- LAS DOS REGLAS DE BORDE, las dos decididas por el dueno el mismo dia:
--
--   1. **Precio de mayor SIN cantidad minima -> nunca se ensena el mayor.**
--      Sin umbral no hay forma de alcanzarlo. Es el lado seguro: un precio
--      mayorista cobrado por una unidad es dinero perdido, y el tendero lo
--      arregla poniendo el minimo, que desde hoy nace en 6. Se midio antes de
--      decidirlo: 3 de los 6 productos de dev con precio de mayor no tienen
--      minimo, asi que el caso no es teorico.
--
--      La base dice otra cosa —la 088 documenta que minimo nulo significa «sin
--      minimo», o sea que el mayor aplica siempre— y esa lectura se descarta
--      aqui a proposito. Queda escrito porque el `check` de la 088 sigue
--      permitiendo el null y alguien podria leerlo y suponer lo contrario.
--
--   2. **Publicado solo al mayor -> se ensena el mayor y NO se deja pedir por
--      debajo del minimo.** Es la unica barrera dura de toda la pantalla, y el
--      dueno la pidio expresamente: con un support text en rojo diciendo la
--      cantidad minima si intenta teclear menos. Se aparta de lo que decidio
--      para el stock —donde se deja pedir de mas y solo se avisa— y la
--      diferencia tiene sentido: el stock es un numero que nadie mantiene, y
--      el minimo del mayor es una condicion de venta que el tendero escribio.
--
-- ===========================================================================
-- EL STOCK SE PUBLICA, Y ESO ES UNA DECISION CON COSTE
--
-- «Disponible: 000» sale del frame y el dueno lo confirmo el 2026-10-14
-- sabiendo lo que implica: el enlace circula, y con el la cantidad que el
-- negocio tiene de cada cosa. Se dice aqui porque es la primera vez que un
-- dato de inventario sale de la app.
--
-- Y es un numero que HOY NO SE MUEVE (`CT-59`): nadie lo descuenta al fiar ni
-- al vender. En la pantalla del tendero eso es tolerable; en una pantalla
-- publica donde alguien PIDE, es una promesa. Por eso el dueno decidio que no
-- bloquee: se deja pedir de mas y se avisa.

begin;

drop function if exists public.get_shared_product(text, uuid);

create function public.get_shared_product(p_token text, p_product_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_tier text;
  v_business text;
  v_logo_path text;
  v_whatsapp text;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  p public.products%rowtype;
  v_retail_pinned json;
  v_wholesale_pinned json;
begin
  select owner_id, tier into v_owner_id, v_tier
  from public.catalog_share_links
  where token = p_token;

  -- Mismo contrato que `get_shared_catalog`: un token que no existe devuelve
  -- null, no un error. La pagina ya sabe pintar su propia pantalla para eso.
  if not found then
    return null;
  end if;

  -- EL PRODUCTO TIENE QUE SER DE ESE DUEÑO Y ESTAR PUBLICADO EN ALGUN ESCALON.
  --
  -- `p_product_id` llega de la URL, o sea del navegador, asi que esto no es
  -- una comodidad: sin el predicado de `owner_id`, cualquiera con un enlace
  -- valido podria leer el producto de OTRO negocio pasando su uuid. Y sin el
  -- de publicado, podria leer uno que su dueno decidio no publicar.
  select * into p
  from public.products
  where id = p_product_id
    and owner_id = v_owner_id
    and trashed_at is null
    and (published_retail or published_wholesale);

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country
    into v_business, v_logo_path, v_whatsapp, v_country
  from public.owners
  where id = v_owner_id;

  select json_object_agg(o.currency, o.amount) into v_retail_pinned
  from public.product_price_overrides o
  where o.product_id = p.id and o.tier = 'retail';

  select json_object_agg(o.currency, o.amount) into v_wholesale_pinned
  from public.product_price_overrides o
  where o.product_id = p.id and o.tier = 'wholesale';

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_logo_path', v_logo_path,
    'owner_whatsapp', v_whatsapp,
    'owner_country', v_country,
    'tier', v_tier,
    'id', p.id,
    'name', p.name,
    'unit', p.unit,
    'description', p.description,
    'photo_path', p.photo_path,
    'base_currency', p.base_currency,
    -- El stock. Ver la cabecera: se publica a proposito y hoy nadie lo mueve.
    'stock', p.stock_opening,
    'wholesale_min_quantity', p.wholesale_min_quantity,
    -- LOS DOS ESCALONES ENTEROS. Cual se ensena lo decide la cantidad, en el
    -- navegador. Un escalon sin precio o sin publicar viaja en null, y la
    -- pantalla lo lee como «este producto no se vende asi».
    'retail', case
      when p.published_retail and p.price_retail is not null then json_build_object(
        'price', p.price_retail,
        'pinned', coalesce(v_retail_pinned, '{}'::json)
      ) else null end,
    'wholesale', case
      when p.published_wholesale and p.price_wholesale is not null then json_build_object(
        'price', p.price_wholesale,
        'pinned', coalesce(v_wholesale_pinned, '{}'::json)
      ) else null end,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

comment on function public.get_shared_product(text, uuid) is
  'El detalle de UN producto para el cliente final, desde un enlace de catalogo. Devuelve los DOS escalones enteros y no decide cual se ensena: eso depende de la cantidad que el cliente elija mientras mira la pantalla (decision del dueno el 2026-10-14, que corrige el frame 1192:4185 -- se ve uno o el otro, nunca los dos), y resolverlo aqui obligaria a una llamada por cada toque del +. Comprueba que el producto sea del dueno del token y este publicado: p_product_id llega de la URL. Un token o un producto que no cuadran devuelven null, igual que get_shared_catalog.';

-- `anon` SI: es una pagina publica, como la del catalogo.
grant execute on function public.get_shared_product(text, uuid) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '104_shared_product_detail',
  'Entregable B del frame 1192:4185: el detalle de un producto para el cliente final. Funcion nueva y no un campo mas en get_shared_catalog, por dos razones: la lista devuelve UN precio por producto y multiplicar los dos escalones mas stock y minimo por cada fila seria pagarlo en cada carga de una pantalla que no lo usa; y porque cambiarle la forma a la funcion que ya sirve el catalogo es la clase de cosa que el 2026-09-04 habria 404eado todos los enlaces de saldo. Devuelve los DOS escalones enteros y NO decide cual se ensena: lo decide la cantidad que el cliente elige, decision del dueno del 2026-10-14 que CORRIGE el frame -- el frame dibuja los dos bloques juntos y el dueno lo descarto con su caso (detal 5 dolares, mayor en tres monedas desde 6 unidades: pedir 3 ensena las del detal, pedir 6 las del mayor, nunca las dos). Resolverlo en la base obligaria a una llamada por cada toque del +. Dos reglas de borde del mismo dia: precio de mayor SIN cantidad minima nunca ensena el mayor --el lado seguro, medido antes de decidirlo: 3 de 6 productos de dev con precio de mayor no tienen minimo, y la 088 dice lo contrario asi que queda escrito--, y publicado solo al mayor ensena el mayor sin dejar pedir por debajo del minimo, que es la unica barrera dura de la pantalla y se aparta de lo decidido para el stock a proposito: el stock es un numero que nadie mantiene y el minimo es una condicion de venta que el tendero escribio. Publica stock_opening, primera vez que un dato de inventario sale de la app, confirmado por el dueno sabiendo que el enlace circula. Comprueba owner_id y publicado porque p_product_id llega de la URL.'
)
on conflict (key) do nothing;

commit;
