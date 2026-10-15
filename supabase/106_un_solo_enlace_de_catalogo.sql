-- UN SOLO ENLACE DE CATALOGO POR NEGOCIO.
--
-- ===========================================================================
-- DECISION DEL DUENO EL 2026-10-15, Y DESPLAZA LA SUYA DEL 2026-10-10
--
-- Hasta hoy habia DOS enlaces por negocio, uno de detal y uno de mayor, y
-- cada uno ensenaba su lista de precios. Era la decision 11 del dueno y
-- `CT-55`, pensada para el Tendero 2, que tiene clientes de los dos tipos.
--
-- **La razon que desplaza queda escrita, porque es la que haria falta para
-- revertir esto**: con dos enlaces, el tendero elige a quien le da precios de
-- mayorista, y quien reenvia un enlace de mayorista le esta dando esos
-- precios a quien lo reciba. Eso dejaba el control en manos del tendero.
--
-- Lo que lo desplaza es el entregable B, construido el 2026-10-14: el detalle
-- de un producto ya decide por CANTIDAD que escalon aplica. Con eso, dos
-- enlaces dejaron de separar dos audiencias y pasaron a ser dos formas de ver
-- lo mismo -- y el dialogo de compartir obligaba a elegir entre dos cosas que
-- ya no se diferenciaban. La consecuencia aceptada: **cualquier cliente puede
-- llegar al precio de mayor pidiendo suficiente**, que es exactamente como
-- funciona una tienda.
--
-- ===========================================================================
-- LOS TOKENS ANTERIORES MUEREN, Y ES GRATIS
--
-- Decision del dueno el 2026-10-15: enlace nuevo, los viejos dejan de abrir.
-- Normalmente eso seria brusco -- cualquier enlace ya compartido por WhatsApp
-- se rompe sin aviso. Aqui no cuesta nada porque **esta tabla no existe en
-- produccion**: la migracion 084 nunca se ha desplegado, asi que los unicos
-- tokens que mueren son los de la rama dev.
--
-- Si esto se vuelve a hacer algun dia con el catalogo ya en produccion, esa
-- linea de arriba deja de ser cierta y hace falta la pantalla de `CT-14`.

begin;

-- ===========================================================================
-- 1. LA TABLA: UNO POR NEGOCIO, SIN ESCALON
-- ===========================================================================

-- Se vacia ANTES de cambiar la restriccion. Con dos filas por negocio, una
-- unica sobre `owner_id` no podria crearse y la migracion fallaria a medias.
delete from public.catalog_share_links;

alter table public.catalog_share_links
  drop constraint if exists catalog_share_links_one_per_tier;

alter table public.catalog_share_links
  drop constraint if exists catalog_share_links_tier_check;

alter table public.catalog_share_links
  drop column if exists tier;

-- SIN `if not exists` PORQUE NO EXISTE PARA RESTRICCIONES, y con el drop
-- delante para que el archivo sobreviva a una segunda ejecucion -- que es la
-- unica forma de corregirlo si sale mal a la primera.
alter table public.catalog_share_links
  drop constraint if exists catalog_share_links_one_per_owner;

alter table public.catalog_share_links
  add constraint catalog_share_links_one_per_owner unique (owner_id);

-- ===========================================================================
-- 2. EL CATALOGO PUBLICO
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

  select json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'unit', p.unit,
      'description', p.description,
      'photo_path', p.photo_path,
      'price', pr.amount,
      'price_tier', pr.tier,
      'base_currency', p.base_currency,
      'pinned', coalesce(ov.pinned, '{}'::json)
    ) order by p.name asc
  )
  into v_products
  from public.products p
  cross join lateral (
    -- EL PRECIO DE UNA UNIDAD, NO EL MAS BAJO. Es el cambio de criterio de
    -- esta migracion y vale la pena entender por que.
    --
    -- La 086 ensenaba el MAS BAJO de los escalones publicados, que con dos
    -- enlaces tenia sentido: cada lista era para una audiencia. Con un solo
    -- enlace, la tarjeta y el detalle son la misma pagina en dos pasos, y el
    -- detalle abre en la cantidad minima -- o sea, al DETAL cuando lo hay.
    --
    -- Ensenar el de mayor en la tarjeta y el de detal al tocarla es un cebo:
    -- el cliente ve 4 $, entra, y le dicen 5 $. Asi que la tarjeta ensena lo
    -- que de verdad va a pagar por una unidad, que es exactamente lo que
    -- devuelve `escalonParaCantidad(producto, 1)` en el navegador.
    select c.tier, c.amount
    from (
      select 'retail'::text as tier, p.price_retail as amount, 1 as prioridad
      where p.published_retail and p.price_retail is not null
      union all
      select 'wholesale'::text, p.price_wholesale, 2
      where p.published_wholesale and p.price_wholesale is not null
    ) c
    -- El de detal primero SIEMPRE, y el de mayor solo si no hay detal
    -- publicado. Si no queda ninguno, el `cross join` no devuelve fila y el
    -- producto no sale del catalogo -- que es lo que se quiere.
    order by c.prioridad asc
    limit 1
  ) pr
  left join lateral (
    -- Los candados del escalon del precio que se ensena, no de los dos.
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = pr.tier
  ) ov on true
  where p.owner_id = v_owner_id
    and p.trashed_at is null
    -- PERTENECE AL CATALOGO SI CUALQUIERA DE LOS DOS ESCALONES ESTA
    -- PUBLICADO. Antes dependia del escalon del enlace; ya no hay escalon.
    -- Las dos casillas de la ficha siguen significando lo mismo para el
    -- PRECIO: un escalon sin publicar no se ensena ni en la tarjeta ni en el
    -- detalle, lo garantiza tambien `get_shared_product`.
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

-- `tier` SALE DE LA RESPUESTA, y eso rompe a quien lo lea. La pagina de la
-- lista lo usaba para la etiqueta «al mayor» de cada tarjeta; ahora esa
-- etiqueta sale de `price_tier`, que ya venia en cada producto y dice lo
-- mismo con mas precision -- por producto y no por enlace.
revoke execute on function public.get_shared_catalog(text) from public;
grant execute on function public.get_shared_catalog(text) to anon, authenticated;

-- ===========================================================================
-- 3. EL DETALLE: EL MISMO, SIN LEER `tier`
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

insert into public.schema_migrations (key, description)
values (
  '106_un_solo_enlace_de_catalogo',
  'Un solo enlace de catalogo por negocio, decision del dueno el 2026-10-15. Desplaza la suya del 2026-10-10 (CT-55, decision 11), que daba dos enlaces -- uno de detal y uno de mayor-- para que el tendero eligiera a quien daba precios mayoristas. Lo que la desplaza es el entregable B: el detalle ya decide por CANTIDAD que escalon aplica, asi que dos enlaces pasaron a ser dos formas de ver lo mismo y el dialogo obligaba a elegir entre cosas que ya no se diferenciaban. Consecuencia aceptada: cualquier cliente llega al precio de mayor pidiendo suficiente, como en una tienda. Los tokens anteriores se BORRAN y los enlaces viejos dejan de abrir -- decision del dueno, y sale gratis porque la 084 nunca se desplego a produccion y los unicos tokens que mueren son los de dev; si esto se repite con el catalogo ya en produccion hara falta la pantalla de CT-14. La tabla pierde la columna tier y gana unica por owner_id. get_shared_catalog ya no filtra por escalon del enlace: un producto pertenece si CUALQUIERA de los dos esta publicado, y la tarjeta ensena el precio de UNA UNIDAD -- detal si lo hay, mayor si no-- en vez del mas bajo, que era el criterio de la 086 y con un solo enlace seria un cebo: el cliente veria 4 y al entrar le dirian 5. get_shared_product no cambia de forma, solo deja de leer tier.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Una sola fila por negocio como mucho, y sin columna `tier`:
--
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'catalog_share_links'
-- order by column_name;
--
-- EXPECTED: created_at, id, owner_id, token. NINGUNA llamada `tier`.
--
-- 2. Que la tabla quedo vacia (los tokens viejos murieron):
--
-- select count(*) as enlaces from public.catalog_share_links;
--
-- EXPECTED: 0. Cada negocio acuna el suyo al abrir «Compartir».
