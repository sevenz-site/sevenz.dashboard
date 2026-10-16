-- 084_products_catalog.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the screens that use it are
-- ready to deploy and the user has said to launch. 083 and 084 travel together:
-- production has neither yet.
--
-- EL CATÁLOGO COMPLETO, segun el frame 1175:5881 de Figma y las cuatro
-- decisiones del dueño del 2026-10-09. Plan: ../docs/INVENTARIO-PLAN.md.
--
-- ===========================================================================
-- POR QUÉ ESTA MIGRACIÓN DESHACE PARTE DE LA 083, QUE ES DE AYER
--
-- La 083 creo `margin_pct`: UN margen por producto. El frame pide dos —al
-- mayor y al detal— porque es lo que dijo el Tendero 2 en campo: «10, 15 ó 30
-- según el caso». Un solo margen no puede representar eso.
--
-- Asi que `margin_pct` se va, y NO SE HACE BACKFILL. La razon no es que no
-- haya datos — comprobado el 2026-10-10, dev tiene una fila, «Pan», con
-- `margin_pct = 30`. Es que ese 30 **no es representable en el modelo nuevo**:
--
--   En la 084 el margen deja de ser un dato que se teclea y pasa a DERIVARSE
--   de costo y precio. «Pan» tiene precio 50 y costo null, asi que su margen
--   derivado es null — no hay nada de lo que un 30 % pueda ser el margen.
--
-- Copiarlo a `margin_retail_pct` guardaria un numero que ninguna pantalla lee
-- y que el primer guardado del producto sobrescribiria con null. Eso es peor
-- que perderlo: un dato que contradice al modelo y que nadie sabe que esta
-- ahi. El 30 se pierde a proposito, y lo que se conserva es lo unico que
-- significa algo — el precio.
--
-- La 083 tampoco llego nunca a produccion, asi que alli no hay nada que mirar.
--
-- ===========================================================================
-- EL COSTO SIGUE SIENDO OPCIONAL, Y ESO ES UNA DECISION DEL DUEÑO (2026-10-09)
--
-- Se le advirtio lo contrario: una ficha que calcula el precio desde el costo
-- deja medio formulario muerto cuando el costo esta vacio. Lo decidio asi de
-- todas formas, y la razon es buena — exigir costo mata el alta rapida dentro
-- de un fiado (decision 11), que es el unico camino por el que esta tabla se
-- va a llenar de verdad.
--
-- Lo que la pantalla hace con eso: cada escalon es una fila de dos controles,
-- el margen y el precio. Con costo, elegir margen rellena el precio. Sin
-- costo, el margen queda inhabilitado DICIENDO POR QUE y el precio se teclea.
-- El esquema no cambia por ello: `products_at_least_one_price` sigue exigiendo
-- un precio y no exige costo, que es exactamente lo que esta decision pide.

begin;

-- ===========================================================================
-- 1. LA FICHA CRECE: DOS MARGENES, CANTIDAD, FOTO, DESCRIPCION Y PUBLICAR
-- ===========================================================================

-- DOS MARGENES, uno por escalon. Medido en campo el 2026-10-09: el Tendero 1
-- aplica un 30 % fijo; el Tendero 2 aplica 10, 15 ó 30 «según el caso», y ese
-- caso es casi siempre si vende al mayor o al detal.
alter table public.products
  add column if not exists margin_retail_pct numeric(6, 2),
  add column if not exists margin_wholesale_pct numeric(6, 2);

-- ───────────────────────────────────────────────────────────────────────────
-- Y UN MARGEN PUEDE SER NEGATIVO. La 083 escribio `check (margin_pct >= 0)`
-- sin pensarlo, y esta migracion NO lo reproduce.
--
-- Encontrado probando la ficha a 375px el 2026-10-10, antes de correr nada:
-- con costo 10 y precio 9 la pantalla calcula un margen de -10 %, que es
-- correcto — es una venta bajo costo. Con aquel check puesto, guardar ese
-- producto fallaba con 23514 y el tendero recibia «No pudimos guardar el
-- producto. Intenta de nuevo», que es falso: el problema no era nuestro ni
-- pasajero, y reintentar nunca iba a funcionar.
--
-- Vender bajo costo es un caso REAL y corriente: liquidacion, mercancia a
-- punto de vencer, una promocion para mover stock parado. Prohibirlo en el
-- esquema es decidir por el tendero cual es su negocio.
--
-- Tampoco hace falta un limite por abajo: con `price > 0` y `cost > 0`, el
-- margen `(precio - costo) / costo` no puede bajar de -100 % por aritmetica.
-- Un check que solo repite lo que ya es imposible es una linea que hay que
-- mantener a cambio de nada.
--
-- Los `drop constraint if exists` se quedan: limpian el check que la 083 dejo
-- en `margin_pct` por si alguna base lo heredo con otro nombre, y hacen el
-- archivo re-ejecutable.
alter table public.products drop constraint if exists products_margin_retail_nonneg;
alter table public.products drop constraint if exists products_margin_wholesale_nonneg;

alter table public.products drop column if exists margin_pct;

-- ───────────────────────────────────────────────────────────────────────────
-- LA CANTIDAD, Y LO QUE TODAVIA NO HACE
--
-- Decision del dueño el 2026-10-09: el campo entra en esta entrega y la
-- maquina de eventos viene despues. Asi que esto es, literalmente, un numero
-- que el tendero escribe y que NADIE MUEVE: fiar o vender no lo descuenta
-- todavia.
--
-- Eso tiene un coste y se dice donde se ve: un stock que no baja miente igual
-- que uno mal calculado, solo que mas despacio. La pantalla lo compensa
-- diciendolo en la propia ficha; el esquema lo compensa eligiendo la forma que
-- la etapa siguiente va a necesitar, no la comoda de hoy.
--
-- Cuando llegue la maquina de eventos, ESTA COLUMNA NO SE CONVIERTE EN LA
-- SUMA: se queda como el primer asiento. El stock pasara a calcularse de
-- `product_stock_events` (ver CT-54 y CT-56), y esta fila sera el evento de
-- apertura con el que se compara todo lo demas. Por eso se llama
-- `stock_opening` y no `stock`: un nombre que prometa «el stock de ahora»
-- seria mentira el dia que exista el calculo de verdad, y lo peor de un nombre
-- asi es que nadie lo cambia.
--
-- numeric(14,3) y no integer: media docena existe, y medio kilo mas.
alter table public.products
  add column if not exists stock_opening numeric(14, 3);

alter table public.products drop constraint if exists products_stock_opening_nonneg;
alter table public.products add constraint products_stock_opening_nonneg
  check (stock_opening is null or stock_opening >= 0);

-- Cuando se escribio esa cantidad. Es la mitad que hace legible el numero
-- mientras no se mueva: «12 docenas, contadas el 9 de octubre» se lee distinto
-- a «12 docenas» a secas tres meses despues.
alter table public.products
  add column if not exists stock_opening_at timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- PUBLICAR, que es lo que separa el catalogo privado del publico.
--
-- `false` por defecto, y no es un detalle: la alternativa —publicar todo y
-- dejar que el tendero oculte— convierte el primer producto que escriba en
-- algo que esta en internet sin que lo haya pedido. Un producto se publica con
-- un gesto; no se despublica con un susto.
alter table public.products
  add column if not exists published boolean not null default false;

-- La foto del producto, en el bucket `product-photos` de la seccion 4. Es una
-- ruta y no una URL: una URL guardada se queda vieja el dia que el bucket
-- cambie de dominio, y ya hay precedente en este proyecto con `logo_path`.
alter table public.products
  add column if not exists photo_path text;

-- Descripcion opcional. La ve el cliente en el catalogo publico, asi que es
-- texto que sale del negocio hacia afuera — ver el aviso de la seccion 3.
alter table public.products
  add column if not exists description text;

-- La consulta del catalogo publico: los publicados de este negocio. Parcial,
-- porque los no publicados son la mayoria y no tienen por que ocupar indice.
create index if not exists products_published_idx
  on public.products (owner_id, name)
  where published and trashed_at is null;

-- ===========================================================================
-- 2. LOS ENLACES DEL CATALOGO — UNO POR ESCALON, NO UNO POR NEGOCIO
-- ===========================================================================
--
-- TABLA PROPIA Y NO `share_links`, que era CT-55 y aqui se cierra.
-- `share_links` tiene `client_id not null unique`: cada enlace es de UN
-- cliente, y ese es justo su valor —el token identifica a quien abre—. Un
-- catalogo no es de nadie en particular; es del negocio, y lo abre quien
-- reciba el mensaje. Meter uno en la otra tabla obligaria a aflojar ese
-- `not null`, y aflojarlo es permitir un enlace de saldo sin cliente.
--
-- ───────────────────────────────────────────────────────────────────────────
-- DOS ENLACES, Y ESTO SE CORRIGIO ANTES DE CORRER NADA
--
-- La primera version de esta migracion puso `owner_id` como clave primaria:
-- UN enlace por negocio, siempre al precio de detal. Estaba mal, y lo dice
-- `CT-55` con todas sus letras: «el dueño querrá varios — uno de mayorista y
-- uno de detal (decision 11 del 2026-10-09)». `CT-53` lo repite desde el otro
-- lado: «los dos precios de T2 se resuelven con la decision 11: cada enlace de
-- catalogo lleva el suyo».
--
-- Es lo que pidio el Tendero 2 en campo. Tiene clientes al mayor y clientes al
-- detal, y un solo catalogo le obliga a elegir a quien enseñarle el precio
-- equivocado.
--
-- UNO POR (negocio, escalon) y no «tantos como quiera»: dos es lo que describe
-- la decision, y el `unique` evita tener que contestar cual de tres enlaces de
-- detal es el bueno. Si algun dia hacen falta mas —un enlace por cliente
-- mayorista, por ejemplo—, es otro cambio y tiene otra forma.
create table if not exists public.catalog_share_links (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.owners (id) on delete cascade,

  -- A QUE PRECIO ABRE ESTE ENLACE. Lo que viaja en el mensaje de WhatsApp es
  -- el token, asi que el escalon viaja con el: quien reenvie un enlace de
  -- mayorista le esta dando precios de mayorista a quien se lo reenvie. Es el
  -- riesgo que `CT-53` ya acepto por escrito, y es el mismo que tiene cualquier
  -- lista de precios impresa.
  tier text not null check (tier in ('retail', 'wholesale')),

  -- 16 bytes de `gen_random_bytes`, igual que `share_links`. No es un uuid: un
  -- uuid v4 se reconoce a la vista como identificador de base de datos, lo que
  -- invita a probar vecinos.
  token text not null unique default encode(gen_random_bytes(16), 'hex'),

  created_at timestamptz not null default now(),

  constraint catalog_share_links_one_per_tier unique (owner_id, tier)
);

create index if not exists catalog_share_links_owner_idx
  on public.catalog_share_links (owner_id);

alter table public.catalog_share_links enable row level security;

drop policy if exists "owners manage own catalog links" on public.catalog_share_links;
create policy "owners manage own catalog links" on public.catalog_share_links
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, delete on public.catalog_share_links to authenticated;

-- Sin `update`: un token no se edita, se borra y se crea otro. Eso deja la
-- rotacion del enlace (que todavia no existe en pantalla) con una sola forma
-- posible, en vez de dos que hay que mantener de acuerdo.

-- ===========================================================================
-- 3. LO QUE VE QUIEN ABRE EL ENLACE
-- ===========================================================================
--
-- SUPERFICIE PUBLICA, SIN SESION. Las reglas de CLAUDE.md para esto son dos y
-- las dos se aplican aqui:
--
--   1. Nunca devolver error crudo. Un token que no existe devuelve `null`, no
--      una excepcion: la pagina pinta su propio mensaje en español y quien
--      pruebe tokens al azar no aprende nada de la forma de la respuesta.
--   2. Devolver lo justo. Esta funcion NO devuelve ni costos, ni margenes, ni
--      `stock_opening`, ni los productos sin publicar, ni el precio del
--      ESCALON QUE NO ES EL DEL ENLACE. El costo de la mercancia de un negocio
--      es exactamente lo que su competidor querria saber; y un cliente de
--      detal con el precio de mayor delante tiene con que regatear. Que el
--      tendero no pueda filtrarlo mal es mejor que confiar en que la pagina no
--      lo pinte.
--
-- EL PRECIO QUE SALE ES EL DEL ESCALON DEL ENLACE, con respaldo: la tabla
-- permite tener solo uno de los dos precios, asi que un enlace de mayor sobre
-- un producto que solo tiene precio de detal enseña ese y lo dice en
-- `price_tier`. Desaparecer del catalogo sin que el tendero entienda por que
-- es peor que enseñar el precio que hay, dicho.
--
-- Y SALEN LOS PRECIOS FIJADOS A MANO de ese escalon, en `pinned`. Esto es lo
-- unico que hace que el candado signifique algo aqui: un tendero que fijo el
-- precio en bolivares lo fijo precisamente para que su cliente vea ESE numero.
-- Si esta pagina recalculara la equivalencia por su cuenta, el candado seria
-- cierto en la ficha y falso en la pantalla donde importa.
--
-- `drop` + `create` y no `create or replace`: `replace` no puede cambiar el
-- tipo de retorno ni los parametros, asi que crearia una segunda sobrecarga en
-- vez de reemplazar nada. Y se dropea ANTES de crear para que el archivo
-- sobreviva a correrse dos veces (CLAUDE.md, «A migration must survive being
-- re-run»).
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
      -- El escalon del NUMERO, que puede no ser el del enlace cuando el
      -- producto solo tiene uno de los dos precios.
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
    and p.published;

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_logo_path', v_logo_path,
    'owner_whatsapp', v_whatsapp,
    'owner_country', v_country,
    -- El escalon del ENLACE, para que la pagina pueda decir de entrada que
    -- estos son precios al mayor. Sin esto, un mayorista no sabe si lo que ve
    -- es su precio o el del publico.
    'tier', v_tier,
    -- `'[]'` y no null: una pagina que recibe null tiene que acordarse de
    -- tratarlo, y un catalogo publicado sin productos es un caso real — el
    -- tendero comparte el enlace y despues publica.
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

-- ===========================================================================
-- 4. EL BUCKET DE LAS FOTOS
-- ===========================================================================
--
-- ESTO NO ES UNA CORRECCION DE PARIDAD: es un bucket NUEVO, asi que hay que
-- crearlo en LOS DOS entornos. No confundirlo con 030_dev_storage_buckets,
-- que existia porque crear una rama de Supabase no clona los buckets.
--
-- PUBLICO, igual que `logos`, y por el mismo motivo: la pagina del catalogo la
-- abre alguien sin sesion y tiene que poder pintar la imagen. La alternativa
-- —bucket privado y URLs firmadas generadas en el servidor— caduca cada hora y
-- obliga a regenerar el enlace de cada foto en cada carga; para una imagen de
-- producto que el tendero esta publicando a proposito, no compra nada.
--
-- Lo que SI hay que saber de un bucket publico: la ruta es `<owner>/<uuid>.jpg`
-- y por tanto no se adivina, pero quien tenga la URL la tiene para siempre,
-- incluso despues de despublicar el producto. Despublicar quita la foto del
-- catalogo, no de internet. Eso es un parrafo de la Politica de privacidad y
-- esta anotado como tal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 5242880,
        array['image/jpeg', 'image/jpg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Mismo juego de politicas que `logos`, carpeta por dueño. `to public` en
-- insert/update/delete replica exactamente lo que 030 dejo en los otros dos
-- buckets: la condicion de carpeta usa `auth.uid()`, que es null para anon, y
-- `(storage.foldername(name))[1] = null` no es cierto nunca.
drop policy if exists "owners upload own product photos" on storage.objects;
create policy "owners upload own product photos" on storage.objects for insert to public
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners update own product photos" on storage.objects;
create policy "owners update own product photos" on storage.objects for update to public
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners delete own product photos" on storage.objects;
create policy "owners delete own product photos" on storage.objects for delete to public
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text);

insert into public.schema_migrations (key, description)
values (
  '084_products_catalog',
  'El catalogo completo, segun el frame 1175:5881 y cuatro decisiones del dueno del 2026-10-09. (1) margin_pct de la 083 se parte en margin_retail_pct y margin_wholesale_pct: el Tendero 2 aplica 10, 15 o 30 por ciento segun venda al mayor o al detal, y un solo margen no representa eso. Y SIN el check >= 0 que tenia la 083: con costo 10 y precio 9 el margen es -10 por ciento, que es una venta bajo costo -- liquidacion, mercancia por vencer, promocion para mover stock -- y con aquel check el guardado fallaba con 23514 y el tendero leia 'No pudimos guardar el producto, intenta de nuevo', que era falso y reintentar no iba a funcionar nunca. No hace falta limite por abajo: con price > 0 y cost > 0 el margen no puede bajar de -100 por ciento por aritmetica. Se dropea SIN backfill, y no porque no haya datos -- dev tenia una fila con margin_pct = 30 -- sino porque en el modelo nuevo el margen se DERIVA de costo y precio, y esa fila no tiene costo: copiar el 30 guardaria un numero que ninguna pantalla lee y que el primer guardado sobrescribiria con null. La 083 nunca llego a produccion. (2) stock_opening + stock_opening_at: la cantidad entra en esta entrega y la maquina de eventos viene despues, asi que es un numero que NADIE MUEVE todavia -- fiar no lo descuenta. Se llama _opening y no stock a proposito: cuando exista product_stock_events esta columna sera el asiento de apertura, no la suma, y un nombre que prometa el stock de ahora seria mentira ese dia. (3) published boolean default FALSE, porque publicar todo por defecto pone en internet el primer producto que alguien escriba sin haberlo pedido. (4) photo_path y description. (5) catalog_share_links, cierra CT-55: tabla propia en vez de share_links, que tiene client_id not null unique y aflojarlo seria permitir un enlace de saldo sin cliente. DOS enlaces por negocio, uno por escalon, con unique (owner_id, tier) -- es la decision 11 del dueno y lo que pidio el Tendero 2, que tiene clientes al mayor y al detal; la primera version de esta migracion puso un solo enlace por negocio y estaba mal. El escalon viaja en el token, asi que reenviar un enlace de mayorista da precios de mayorista: riesgo ya aceptado por escrito en CT-53. Sin grant de update: un token se borra y se crea otro, nunca se edita. (6) get_shared_catalog(text), SECURITY DEFINER para anon, devuelve null ante un token inexistente en vez de error, y deliberadamente NO devuelve costo, margen, stock ni el precio del escalon que no es el del enlace -- el costo es lo que querria saber la competencia y el precio de mayor es con lo que regatea un cliente de detal, asi que se filtra en la funcion y no en la pagina. Un producto que solo tiene uno de los dos precios enseña ese y lo dice en price_tier, en vez de desaparecer sin explicacion. Y devuelve los precios FIJADOS A MANO de ese escalon en pinned: sin eso el candado seria cierto en la ficha y falso en la pantalla publica, que es justo donde el tendero lo fijo para que se viera. (7) bucket product-photos, PUBLICO como logos porque la pagina la abre alguien sin sesion; ojo: despublicar quita la foto del catalogo, no de internet. Bucket NUEVO, hay que crearlo en los dos entornos -- no es una correccion de paridad como la 030.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICACION, despues de correr lo de arriba
-- ===========================================================================
--
-- Lo cubre `npm run qa:catalogo` desde el directorio `dashboard/`, que apunta
-- a la rama DEV (vzqppwrwnmlbrxizskdh) por .env.local y se niega a correr
-- contra cualquier otra cosa. Lo que comprueba, y por que cada cosa, esta en
-- la cabecera de `qa/catalogo.mjs`.
--
-- Lo unico que no se puede comprobar desde ahi, porque la clave de servicio
-- salta RLS, es que la politica de `catalog_share_links` acote por dueño. Esto
-- en el editor SQL de la rama DEV (vzqppwrwnmlbrxizskdh):
--
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'catalog_share_links';
--   -- EXPECTED: una politica ALL con `owner_id = auth.uid()`.
