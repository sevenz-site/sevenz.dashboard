-- 085_catalog_publish_per_tier.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083, 084 y 085 viajan juntas: produccion no tiene ninguna.
--
-- AJUSTES DEL FRAME 1187:3728. Son tres cosas y cada una viene de una
-- decision del dueno del 2026-10-10.
--
-- ===========================================================================
-- 1. PUBLICAR DEJA DE SER UN SI/NO Y PASA A SER POR ESCALON
--
-- El frame pone un interruptor «Publicar producto en catálogo» y, debajo, dos
-- casillas: «Incluir precio al mayor» e «Incluir precio al detal».
--
-- La 084 tenia un solo `published`, y con el los dos enlaces ensenaban los
-- mismos productos a distinto precio. Eso no es lo que pidio el Tendero 2: el
-- querra ensenar su lista de mayorista a unos y la de detal a otros, y hay
-- productos que solo vende de una forma.
--
-- ===========================================================================
-- 2. UN PRECIO EN BOLIVARES NO SE PUEDE FIJAR, Y AHORA LO IMPIDE EL ESQUEMA
--
-- Decision del dueno el 2026-10-10: la fila de bolivares se queda en la ficha
-- pero SOLO CALCULADA, sin candado.
--
-- La 084 lo permitia a proposito, con este argumento escrito en la 083: «la
-- tabla lo permite porque el modelo no debe decidir eso; la pantalla si tiene
-- que decidirlo». Ese argumento se queda corto aqui, y conviene decir por que
-- en vez de borrarlo:
--
--   Lo que una pantalla decide, otra pantalla lo deshace. Si el candado de
--   bolivares solo esta apagado en el formulario, el dia que alguien anada
--   otro sitio donde se fije un precio —el selector del formulario de
--   movimiento, por ejemplo— no hay nada que le recuerde esta decision.
--
-- Y el precio que se fija en bolivares es el unico de la ficha que SE VUELVE
-- FALSO SOLO: manana la tasa se movio y ese numero ya no cuadra con los otros
-- tres. Es la misma razon por la que el libro de Sevenz nunca tuvo dimension
-- de bolivares.
--
-- La fila de hoy en dev es un artefacto de mis pruebas del 2026-10-10
-- (Bs. 12.000 sobre «Harina de maíz»). Se borra, y no por limpieza: sin
-- borrarla quedaria un candado cerrado que la pantalla nueva ya no sabe
-- abrir, o sea un precio congelado para siempre y sin control que lo suelte.
--
-- ===========================================================================
-- 3. LO QUE ESTA MIGRACION NO TOCA
--
-- `price_retail` y `price_wholesale` se quedan como estan. El frame quita el
-- CAMPO «Precio al mayor» de la pantalla porque duplicaba la fila «Precio
-- Dólar» que ya estaba justo debajo — el mismo numero dos veces. La columna
-- sigue siendo el precio en la moneda del negocio; lo que cambia es que ahora
-- se teclea en su propia fila.

begin;

-- ===========================================================================
-- 1. PUBLICAR, POR ESCALON
-- ===========================================================================

alter table public.products
  add column if not exists published_retail boolean not null default false,
  add column if not exists published_wholesale boolean not null default false;

-- El traspaso de lo que ya hay. `published` solo existio en dev y solo un dia,
-- asi que esto mueve un punado de filas; se escribe igualmente porque la
-- alternativa —dar por hecho que no hay nada— es como se pierden datos de
-- verdad el dia que si los hay.
--
-- Va a DETAL y no a los dos: es lo que significaba «publicado» hasta hoy, ya
-- que `get_shared_catalog` de la 084 ensenaba el precio de detal por defecto.
-- Mandarlo tambien a mayor pondria listas de mayorista en manos de clientes
-- normales sin que nadie lo pidiera.
update public.products
set published_retail = true
where published and not published_retail;

alter table public.products drop column if exists published;

-- El indice de la 084 apuntaba a `published`, que ya no existe. Dos indices
-- parciales, uno por escalon, porque las dos consultas son distintas.
drop index if exists public.products_published_idx;

create index if not exists products_published_retail_idx
  on public.products (owner_id, name)
  where published_retail and trashed_at is null;

create index if not exists products_published_wholesale_idx
  on public.products (owner_id, name)
  where published_wholesale and trashed_at is null;

-- ===========================================================================
-- 2. LOS BOLIVARES NO SE FIJAN
-- ===========================================================================

-- Primero los que haya, porque el check de abajo no entra con filas que lo
-- violen — y porque un candado que la pantalla ya no sabe abrir es un precio
-- congelado sin control que lo suelte.
delete from public.product_price_overrides where currency = 'VES';

alter table public.product_price_overrides
  drop constraint if exists product_price_overrides_currency_check;

alter table public.product_price_overrides
  drop constraint if exists product_price_overrides_fixable_currency;

-- COP tampoco: un negocio colombiano cobra en pesos y no tiene ninguna otra
-- moneda que convertir, asi que su precio en pesos es `price_retail` /
-- `price_wholesale` y nunca un override de nada.
alter table public.product_price_overrides
  add constraint product_price_overrides_fixable_currency
  check (currency in ('USD', 'EUR', 'USDT'));

-- ===========================================================================
-- 3. EL CATALOGO PUBLICO FILTRA POR EL ESCALON DE SU ENLACE
-- ===========================================================================
--
-- Mismo cuerpo que la 084 con un solo cambio de fondo: donde decia
-- `and p.published` ahora dice la columna que corresponde al escalon del
-- enlace. Un producto publicado solo al detal NO sale en el enlace de
-- mayorista, y al reves.
--
-- `drop` + `create` otra vez, no `replace`: aunque la firma no cambie, el
-- archivo tiene que sobrevivir a correrse dos veces y `drop ... if exists` con
-- la firma exacta es lo unico que lo garantiza (CLAUDE.md, «A migration must
-- survive being re-run»).
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
    select
      case when v_tier = 'wholesale'
        then coalesce(p.price_wholesale, p.price_retail)
        else coalesce(p.price_retail, p.price_wholesale)
      end as amount,
      case when v_tier = 'wholesale'
        then case when p.price_wholesale is not null then 'wholesale' else 'retail' end
        else case when p.price_retail is not null then 'retail' else 'wholesale' end
      end as tier
  ) pr
  left join lateral (
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = pr.tier
  ) ov on true
  where p.owner_id = v_owner_id
    and p.trashed_at is null
    -- EL CAMBIO. Cada enlace ensena lo publicado para SU escalon.
    and case when v_tier = 'wholesale' then p.published_wholesale else p.published_retail end
    -- Y nunca una fila sin precio: la tabla exige uno de los dos, pero
    -- `coalesce` de arriba podria quedar en null si eso cambiara algun dia, y
    -- un producto sin precio en un catalogo publico es un hueco que nadie
    -- sabe explicar.
    and pr.amount is not null;

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
  '085_catalog_publish_per_tier',
  'Ajustes del frame 1187:3728, tres decisiones del dueno del 2026-10-10. (1) `published` se parte en published_retail y published_wholesale: el frame pone un interruptor mas dos casillas, y con un solo booleano los dos enlaces ensenaban los mismos productos a distinto precio -- que no es lo que pidio el Tendero 2, que tiene productos que solo vende de una forma. El traspaso manda lo publicado a DETAL y no a los dos, porque eso es lo que significaba published hasta hoy y mandarlo tambien a mayor pondria listas de mayorista en manos de clientes normales sin que nadie lo pidiera. Dos indices parciales en vez de uno. (2) Un precio en bolivares ya no se puede fijar: la fila se queda en la ficha pero solo calculada, sin candado, y ahora lo impide un check (currency in USD, EUR, USDT) en vez de solo la pantalla. La 083 argumentaba lo contrario -- que el modelo no debe decidirlo -- y se queda corto: lo que una pantalla decide, otra lo deshace, y un precio en bolivares es el unico de la ficha que se vuelve falso solo cuando se mueve la tasa. Se borran los overrides VES existentes, que en dev son un artefacto de las pruebas del 2026-10-10; sin borrarlos quedaria un candado cerrado que la pantalla nueva ya no sabe abrir, o sea un precio congelado sin control que lo suelte. COP tampoco entra: un negocio colombiano no tiene nada que convertir. (3) get_shared_catalog filtra por la columna del escalon de su enlace, y descarta ademas cualquier fila sin precio.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICACION
-- ===========================================================================
--
-- Lo cubre `npm run qa:catalogo` desde `dashboard/`, que apunta a la rama DEV
-- (vzqppwrwnmlbrxizskdh) por .env.local y se niega a correr contra otra cosa.
