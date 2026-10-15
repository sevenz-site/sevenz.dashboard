-- EL CATALOGO PUBLICO ENSENA SI HAY O NO HAY.
--
-- ===========================================================================
-- POR QUE UNA MIGRACION PARA UN SOLO CAMPO
--
-- El frame `1190:5748` pone en cada tarjeta una etiqueta de inventario, y la
-- lista no traia el dato: `get_shared_catalog` devolvia nombre, precio,
-- escalon, foto y los candados, y nada mas. El detalle (`get_shared_product`)
-- si lo traia desde la 104 -- es donde sale «Disponible: 40».
--
-- ===========================================================================
-- TRES ESTADOS Y NO DOS, Y EL TERCERO ES EL QUE IMPORTA
--
-- Decision del dueno el 2026-10-15, preguntada antes de construirla porque el
-- frame solo dibuja dos:
--
--   stock > 0   → «Disponible: NN», en verde.
--   stock = 0   → «No disponible», en rojo.
--   stock null  → «Disponible», en verde y SIN cifra.
--
-- El tercero existe porque **hoy casi ningun producto tiene inventario
-- escrito**: `stock_opening` nace nulo salvo que el tendero lo ponga, y es un
-- numero que nadie mantiene (`CT-59`). Con dos estados, 5 de los 6 productos
-- de dev saldrian en rojo como «No disponible» estando en el mostrador -- y el
-- tendero se enteraria por un cliente que no le compro.
--
-- La diferencia entre null y 0 pasa a significar algo publico, asi que **este
-- campo no se puede empezar a rellenar con un default**: un `0` puesto por
-- comodidad apagaria el producto en el catalogo de alguien.

begin;

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
      -- LO NUEVO. Null viaja como null a proposito: la pantalla distingue
      -- «no hay» de «no se sabe», y aplanarlo aqui a 0 convertiria lo segundo
      -- en lo primero sin que nadie lo notara.
      'stock', p.stock_opening,
      'pinned', coalesce(ov.pinned, '{}'::json)
    ) order by p.name asc
  )
  into v_products
  from public.products p
  cross join lateral (
    -- EL PRECIO DE UNA UNIDAD, NO EL MAS BAJO (migracion 106). La tarjeta y el
    -- detalle son la misma pagina en dos pasos, y el detalle abre en la
    -- cantidad minima: ensenar el de mayor fuera y cobrar el de detal dentro
    -- seria un cebo.
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
  ) pr
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

insert into public.schema_migrations (key, description)
values (
  '107_catalogo_publica_el_inventario',
  'get_shared_catalog devuelve stock_opening por producto, para la etiqueta de inventario del frame 1190:5748. El detalle ya lo traia desde la 104. TRES estados y no los dos que dibuja el frame, decision del dueno el 2026-10-15 preguntada antes de construirla: mayor que cero es «Disponible: NN» en verde, cero es «No disponible» en rojo, y NULO es «Disponible» en verde sin cifra. El tercero existe porque hoy casi ningun producto tiene inventario escrito --nace nulo y nadie lo mantiene, CT-59-- y con dos estados 5 de los 6 productos de dev saldrian en rojo estando en el mostrador, cosa de la que el tendero se enteraria por un cliente que no le compro. Null viaja como null hasta la pantalla a proposito: aplanarlo a 0 aqui convertiria «no se sabe» en «no hay». Consecuencia que conviene recordar: la diferencia entre null y 0 ya significa algo publico, asi que este campo no se puede empezar a rellenar con un default.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- Cada producto trae su `stock`, y los nulos siguen siendo nulos:
--
-- select p->>'name' as producto, p->'stock' as stock
-- from public.catalog_share_links l,
--      lateral json_array_elements(public.get_shared_catalog(l.token)->'products') p
-- limit 10;
--
-- EXPECTED: una fila por producto publicado, con su cantidad o `null`.
-- Un `0` donde deberia haber `null` significa que algo lo aplano.
