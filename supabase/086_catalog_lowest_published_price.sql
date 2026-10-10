-- 086_catalog_lowest_published_price.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083, 084, 085 y 086 viajan juntas: produccion no tiene ninguna.
--
-- ===========================================================================
-- LA TARJETA QUE VE EL CLIENTE ENSENA SIEMPRE EL PRECIO MAS BAJO
--
-- Decision del dueno el 2026-10-10, junto con dejar las dos casillas de
-- publicar marcadas por defecto. Las dos van juntas: si un producto se publica
-- en los dos escalones por defecto, hay que decir cual de los dos precios ve
-- el cliente, y la respuesta es el menor.
--
-- UN ESCALON NO PUBLICADO NUNCA ES CANDIDATO. Ensenar su precio seria publicar
-- un numero que el tendero decidio no publicar, y eso lo decide esta funcion y
-- no la pagina, por la misma razon que todo lo demas que filtra aqui: la
-- pagina se puede reescribir, y lo que no sale de la base no se puede filtrar
-- mal.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTO LE HACE A LOS DOS ENLACES, dicho al dueno ANTES de decidirlo y
-- aceptado por el:
--
--   Los dos enlaces dejan de diferenciarse por el PRECIO. Un producto
--   publicado en los dos escalones sale con el mismo numero en los dos
--   enlaces. Lo que sigue distinguiendolos es QUE PRODUCTOS incluyen: el de
--   mayor es el que ademas trae los que solo se venden al mayor.
--
-- Queda escrito aqui porque `CT-55` y la 084 se construyeron con la idea
-- contraria —dos listas de precios para dos audiencias— y quien lea aquella
-- justificacion sin esta se va a preguntar por que no funciona asi.

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
  v_tier text;
  v_business text;
  v_logo_path text;
  v_whatsapp text;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  v_products json;
begin
  select owner_id, tier into v_owner_id, v_tier
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
    -- EL PRECIO MAS BAJO DE LOS ESCALONES QUE ESTEN PUBLICADOS. Ver la
    -- cabecera. Si no queda ninguno candidato, el `cross join` no devuelve
    -- fila y el producto no sale del catalogo -- que es lo que se quiere, y
    -- de paso sustituye al `pr.amount is not null` que llevaba la 085.
    select c.tier, c.amount
    from (
      select 'retail'::text as tier, p.price_retail as amount
      where p.published_retail and p.price_retail is not null
      union all
      select 'wholesale'::text, p.price_wholesale
      where p.published_wholesale and p.price_wholesale is not null
    ) c
    -- `c.tier asc` desempata: con los dos precios iguales sale 'retail', que
    -- es el que el cliente espera ver. Sin el desempate el orden lo decidiria
    -- el planificador y podria cambiar entre dos cargas de la misma pagina.
    order by c.amount asc, c.tier asc
    limit 1
  ) pr
  left join lateral (
    -- Los candados del escalon DEL PRECIO ELEGIDO, no del escalon del enlace.
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = pr.tier
  ) ov on true
  where p.owner_id = v_owner_id
    and p.trashed_at is null
    -- La pertenencia SI sigue siendo por el escalon del enlace: es lo que
    -- significan las dos casillas de la ficha.
    and case when v_tier = 'wholesale' then p.published_wholesale else p.published_retail end;

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
    'products', coalesce(v_products, '[]'::json),
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

grant execute on function public.get_shared_catalog(text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '086_catalog_lowest_published_price',
  'Decision del dueno el 2026-10-10: la tarjeta que ve el cliente ensena SIEMPRE el precio mas bajo. get_shared_catalog elige el menor de los escalones PUBLICADOS en vez del escalon del enlace -- un escalon no publicado nunca entra, porque ensenar su precio seria publicar un numero que el tendero decidio no publicar. Si no queda ningun candidato el producto sale del catalogo, lo que de paso sustituye al pr.amount is not null de la 085. Consecuencia dicha al dueno antes de decidir y aceptada: los dos enlaces dejan de diferenciarse por el PRECIO y pasan a diferenciarse solo por QUE PRODUCTOS incluyen -- el de mayor es el que ademas trae los que solo se venden al mayor. price_tier sigue viajando para que la pagina pueda decir de que precio se trata, y los candados se leen del escalon del precio elegido, no del escalon del enlace.'
)
on conflict (key) do nothing;

commit;
