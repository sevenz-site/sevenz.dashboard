-- 083_products.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the screens that use it are
-- ready to deploy and the user has said to launch.
--
-- LA FICHA DE PRODUCTO. Primera pieza de la etapa 1 de inventario y catálogo.
-- Plan y decisiones: ../docs/INVENTARIO-PLAN.md. Fichas CT-49 a CT-57.
--
-- ===========================================================================
-- LO QUE ESTA MIGRACIÓN NO TRAE, Y NO ES UN OLVIDO
--
-- No hay stock. Esta migración crea el catálogo —qué vende este negocio y a
-- qué precio— y nada más. El stock es la siguiente, porque se calcula de
-- eventos y esos eventos cuelgan de aquí.
--
-- Tampoco hay categorías, variantes ni SKU. Medido en la investigación de
-- campo del 2026-10-09: un solo tendero vende repuestos de vehículo,
-- medicinas, ropa, herramientas y ferretería. No es un comercio con
-- estanterías, es «consigo lo que me pidas», y una taxonomía no le sirve de
-- nada. La ficha va al mínimo a propósito.
--
-- ===========================================================================
-- POR QUÉ NO SE EXIGE CASI NADA
--
-- Los dos tenderos entrevistados el 2026-10-09 dijeron, con esas palabras, que
-- NO llevan inventario. Si dar de alta un producto pide ocho campos, ninguno
-- de los dos lo hace una segunda vez.
--
-- Obligatorio: el nombre y UN precio. Todo lo demás —unidad, costo, margen, el
-- otro precio— es complementario y se añade cuando y si hace falta.
--
-- Esto es lo que hace posible la decisión 11 del dueño: un producto que
-- aparece por primera vez dentro de un fiado queda CREADO ahí mismo, no
-- pendiente de cargar. Si la tabla exigiera más, ese atajo sería imposible.

begin;

-- ===========================================================================
-- 1. EL PRODUCTO
-- ===========================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.owners (id) on delete cascade,

  name text not null check (btrim(name) <> ''),

  -- ETIQUETA LIBRE, SIN CONVERSIONES. "unidad", "docena", "bulto", "kilo".
  -- El stock se contará en lo que diga esta columna y nada más.
  --
  -- Se sabe de antemano a quién le va a quedar corto: el Tendero 1 compra por
  -- docena y vende por unidad, así que si declara el producto en docenas su
  -- stock dirá 1 cuando le queden 11 sueltas. Se acepta porque la V1 no promete
  -- exactitud (ver CT-51: es una guía, no un conteo) y porque la conversión
  -- docena→unidad es un campo más que nadie llena el primer día. Es la primera
  -- iteración que va a pedir, no un descuido.
  unit text,

  -- LA MONEDA EN LA QUE EL TENDERO TECLEÓ EL PRECIO. Las demás se calculan a
  -- partir de ella con las tasas que ya existen en producción.
  --
  -- Explícita, y aquí 'COP' se escribe en vez de dejarse null —al revés que
  -- `movements.currency`, donde null SIGNIFICA COP—. La diferencia es
  -- deliberada: en movimientos el null existe porque el libro se agrupa por esa
  -- columna y un libro colombiano no tiene dimensión de moneda. Un precio no
  -- se agrupa por nada; lo único que necesita es decir en qué está.
  base_currency text not null
    check (base_currency in ('COP', 'USD', 'EUR', 'USDT', 'VES')),

  -- Dos precios, los dos opcionales por separado y al menos uno obligatorio.
  -- Decisión del dueño el 2026-10-09: el catálogo lleva precio al mayor y al
  -- detal, y al crear un producto sobre la marcha el tendero marca cuál está
  -- escribiendo. Por eso ninguno de los dos puede ser `not null` por su cuenta.
  price_retail numeric(14, 4) check (price_retail is null or price_retail > 0),
  price_wholesale numeric(14, 4) check (price_wholesale is null or price_wholesale > 0),

  -- EL MARGEN, que es el único dolor que nombraron los dos tenderos (CT-53).
  -- Uno aplica un 30 % fijo; el otro 10, 15 o 30 según venda al mayor o al
  -- detalle. Los dos hacen esa cuenta a mano, producto por producto.
  --
  -- El costo va en `base_currency`, igual que los precios: dos monedas en la
  -- misma ficha obligarían a convertir para calcular un margen, y un margen
  -- que depende de la tasa del día no es un margen.
  cost numeric(14, 4) check (cost is null or cost > 0),
  margin_pct numeric(6, 2) check (margin_pct is null or margin_pct >= 0),

  -- Papelera, como `clients`. Ver CT-44: hoy la papelera solo sabe pintar
  -- clientes, así que un producto borrado todavía no tiene dónde caer. La
  -- columna existe desde ya para no tener que migrar datos después.
  trashed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- AL MENOS UN PRECIO. Es la mitad del mínimo obligatorio —la otra es el
  -- nombre— y lo que permite que un producto nazca dentro de un fiado.
  constraint products_at_least_one_price
    check (price_retail is not null or price_wholesale is not null)
);

-- La consulta caliente es «los productos de este negocio», y siempre sin los
-- de la papelera.
create index if not exists products_owner_idx
  on public.products (owner_id, trashed_at);

-- Buscar por nombre al registrar un movimiento: es lo que hará el tendero con
-- una mano mientras atiende. `text_pattern_ops` sobre el nombre en minúsculas
-- sirve a un `like 'jab%'`, que es la forma que tiene un buscador de teclear.
create index if not exists products_owner_name_idx
  on public.products (owner_id, lower(name) text_pattern_ops);

alter table public.products enable row level security;

create policy "owners manage own products" on public.products
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.products to authenticated;

-- EL PRODUCTO ES DEL DUEÑO, NO DE LA PLATAFORMA. Se consideró un catálogo
-- compartido entre negocios —suena eficiente— y se descartó: dos bodegas
-- llaman distinto a lo mismo y ninguna quiere que la otra le cambie el precio.

-- ===========================================================================
-- 2. LOS PRECIOS FIJADOS A MANO
-- ===========================================================================
--
-- Decisión del dueño el 2026-10-09: la ficha enseña el precio en cada moneda
-- calculado automáticamente, **y cada uno se puede editar**, con un candado que
-- lo desvincula del cálculo y que se puede volver a abrir para revertir.
--
-- LA FORMA SIGUE A ESA DECISIÓN: aquí solo viven los desvinculados. Un precio
-- calculado no se guarda, se calcula. Así que **desvincular es insertar una
-- fila y volver a vincular es borrarla**, que es exactamente lo que el candado
-- hace y deja el estado imposible de desincronizar.
--
-- La alternativa era ocho columnas nullable en `products` —cuatro monedas por
-- dos precios— donde null significaría «calculado». Misma información y mucha
-- más superficie para que una se quede a medias.
--
-- AVISO SOBRE BOLÍVARES, que es el candado que puede hacer daño: un precio en
-- bolívares fijado a mano **envejece solo**. Mañana la tasa se movió y ese
-- número ya no cuadra con los demás de la misma ficha. Es exactamente la razón
-- por la que el libro de Sevenz nunca tuvo dimensión de bolívares. La tabla lo
-- permite porque el modelo no debe decidir eso; la pantalla sí tiene que
-- decidirlo, y está pendiente.
create table if not exists public.product_price_overrides (
  product_id uuid not null references public.products (id) on delete cascade,

  tier text not null check (tier in ('retail', 'wholesale')),

  currency text not null check (currency in ('COP', 'USD', 'EUR', 'USDT', 'VES')),

  amount numeric(14, 4) not null check (amount > 0),

  -- Cuándo se fijó. Para un precio en bolívares es la diferencia entre «este
  -- número es de hoy» y «este número es de hace tres semanas», que es lo único
  -- que hace legible un precio que envejece.
  set_at timestamptz not null default now(),

  primary key (product_id, tier, currency)
);

alter table public.product_price_overrides enable row level security;

-- Vía el producto, porque esta tabla no lleva `owner_id`. Mismo patrón que
-- `share_links`, que tampoco lo lleva y se acota por `clients`.
create policy "owners manage own product price overrides"
  on public.product_price_overrides
  for all using (
    exists (
      select 1 from public.products p
      where p.id = product_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.products p
      where p.id = product_id and p.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.product_price_overrides to authenticated;

insert into public.schema_migrations (key, description)
values (
  '083_products',
  'La ficha de producto: primera pieza de la etapa 1 de inventario y catalogo. NO trae stock -- eso es la siguiente, y cuelga de aqui. Tampoco categorias, variantes ni SKU: medido en campo el 2026-10-09, un solo tendero vende repuestos, medicinas, ropa, herramientas y ferreteria, asi que una taxonomia no le sirve de nada. Obligatorio solo el nombre y UN precio, porque los dos tenderos entrevistados dijeron que NO llevan inventario y una ficha de ocho campos no se llena dos veces -- y porque es lo que permite que un producto nazca dentro de un fiado en vez de quedar pendiente de cargar (decision 11 del dueno). Dos precios, detal y mayor, los dos opcionales por separado y al menos uno obligatorio por check. base_currency explicita e incluye COP, al reves que movements.currency donde null SIGNIFICA COP: alli el null existe porque el libro se agrupa por esa columna, y un precio no se agrupa por nada. cost y margin_pct en la misma moneda que los precios, porque un margen que depende de la tasa del dia no es un margen. Y product_price_overrides guarda SOLO los precios desvinculados a mano: un precio calculado no se guarda, se calcula, asi que desvincular es insertar una fila y volver a vincular es borrarla -- el candado de la pantalla hecho esquema, imposible de desincronizar. Aviso escrito en la tabla: un precio en bolivares fijado a mano envejece solo, que es la razon por la que el libro nunca tuvo dimension de bolivares.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICACION, despues de correr lo de arriba
-- ===========================================================================
--
-- Correr TODO esto en la rama DEV (vzqppwrwnmlbrxizskdh).
--
-- 1. Un producto sin ningun precio no entra:
--
--   begin;
--   insert into public.products (owner_id, name, base_currency)
--   values ((select id from public.owners limit 1), 'prueba sin precio', 'USD');
--   rollback;
--   -- EXPECTED: falla con 23514, products_at_least_one_price. Si entra, un
--   -- producto puede existir sin precio y el catalogo enseña un hueco.
--
-- 2. Un producto con solo uno de los dos precios SI entra:
--
--   begin;
--   insert into public.products (owner_id, name, base_currency, price_retail)
--   values ((select id from public.owners limit 1), 'prueba detal', 'USD', 12);
--   insert into public.products (owner_id, name, base_currency, price_wholesale)
--   values ((select id from public.owners limit 1), 'prueba mayor', 'USD', 10);
--   rollback;
--   -- EXPECTED: las dos entran. Es el caso de los chips detal/mayor.
--
-- 3. Nadie ve los productos de otro:
--
--   select count(*) as politicas from pg_policies
--   where schemaname = 'public' and tablename in ('products', 'product_price_overrides');
--   -- EXPECTED: 2, una por tabla.
--
-- 4. El candado no admite dos valores para la misma casilla:
--
--   select conname from pg_constraint
--   where conrelid = 'public.product_price_overrides'::regclass and contype = 'p';
--   -- EXPECTED: la clave primaria (product_id, tier, currency). Es lo que
--   -- impide que un precio quede fijado dos veces con numeros distintos.
