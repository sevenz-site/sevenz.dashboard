-- LOS PRODUCTOS QUE HAY EN UN CARRITO, DE GOLPE.
--
-- ===========================================================================
-- POR QUE HACE FALTA, Y NO VALE `get_shared_catalog`
--
-- El carrito guarda `{ productId, quantity, currency }` y NADA MAS: ni precio
-- ni nombre. La razon esta en la cabecera de `lib/cart/cart.ts` y la de peso
-- es esta: **el escalon depende de la cantidad total**, asi que anadir 3 y
-- luego 3 mas cambia el precio de esa linea. Un precio congelado al anadir
-- seria el de detal para una cantidad que ya es de mayor.
--
-- Asi que la pantalla del carrito pide los productos cada vez. Y no le sirve
-- `get_shared_catalog`, que devuelve UN precio por producto —el de una unidad,
-- migracion 107— junto con los candados de ESE escalon. El carrito necesita
-- los DOS escalones enteros, igual que el detalle.
--
-- `get_shared_product` ya devuelve eso, pero de uno en uno: un carrito de doce
-- lineas serian doce viajes. Esta es la misma informacion para varios ids.
--
-- ===========================================================================
-- DEVUELVE SOLO LO QUE SIGUE VALIENDO, Y ESO ES UNA DECISION
--
-- Un producto que el tendero despublico o mando a la papelera mientras el
-- cliente armaba el pedido NO sale. La pantalla compara lo que pidio con lo
-- que recibio y marca las lineas huerfanas como «ya no esta disponible».
--
-- La alternativa —devolverlo con una marca— se descarto: obligaria a que cada
-- sitio que lea esta respuesta se acuerde de filtrarlo, y el dia que uno se
-- olvide ensenara el precio de algo que ya no se vende. Ausente es un estado
-- que no se puede ignorar por descuido.

begin;

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

insert into public.schema_migrations (key, description)
values (
  '110_productos_del_carrito',
  'get_shared_products(token, ids[]): los dos escalones enteros de varios productos de una vez, para pintar el carrito. No vale get_shared_catalog, que devuelve UN precio por producto --el de una unidad, migracion 107-- con los candados de ese escalon; el carrito necesita los dos, igual que el detalle, porque el escalon depende de la cantidad y la cantidad cambia al fusionar lineas. Y no vale get_shared_product porque seria un viaje por linea. Devuelve SOLO lo que sigue publicado y sin borrar: un producto despublicado mientras el cliente armaba el pedido no sale, y la pantalla marca esa linea como no disponible comparando lo que pidio con lo que recibio. Devolverlo con una marca se descarto -- obligaria a que cada lector se acuerde de filtrarlo, y ausente es un estado que no se puede ignorar por descuido. Tope de 50 ids, el mismo que el de lineas de la 109: la llama cualquiera con el enlace.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- Con un token real y dos ids de productos publicados de ese negocio:
--
-- select public.get_shared_products('<token>', array['<id1>','<id2>']::uuid[]);
--
-- EXPECTED: `products` con las dos fichas, cada una con `retail` y
-- `wholesale` (null el que no este publicado). Un id de otro negocio no
-- aparece en la respuesta.
