-- LAS ORDENES DEL CATALOGO PUBLICO. Entregables C y D del frame 1192:4185.
--
-- ===========================================================================
-- ESTA ES LA PRIMERA ESCRITURA ANONIMA DE SEVENZ, Y ESO LO CAMBIA TODO
--
-- Hasta hoy `anon` solo LEE: `/s/[token]` y `/c/[token]` sirven paginas sin
-- sesion, y lo unico que un visitante podia escribir era su propio
-- consentimiento de WhatsApp (migracion 081), atado a un cliente que ya
-- existia. Una orden la teclea alguien de quien no sabemos nada, por un enlace
-- hecho para circular.
--
-- Por eso esta migracion no es «dos tablas y un insert». Son CINCO candados,
-- acordados con el dueno el 2026-10-15, y cada uno cierra una puerta distinta:
--
--   1. EL DUENO SALE DEL TOKEN, nunca del navegador. Es la misma regla que
--      `get_shared_catalog`, y la razon por la que no hay un `p_owner_id`.
--   2. CADA PRODUCTO SE VALIDA: de ese dueno, sin borrar, y publicado. Un id
--      cualquiera pegado en la peticion no entra.
--   3. TOPES DE TAMANO: cuantas lineas, cuanto texto. Sin esto, una sola
--      peticion puede escribir megabytes.
--   4. TOPE POR TOKEN Y POR MINUTO. Lo que impide que un guion meta miles.
--   5. EL PRECIO LO CALCULA ESTA FUNCION, NO VIAJA DESDE EL NAVEGADOR.
--
-- EL QUINTO ES EL QUE NO ES OBVIO Y EL QUE MAS IMPORTA. Si la pagina mandara
-- «producto X, 2 unidades, 5 USD», cualquiera con las herramientas del
-- navegador abiertas cambia ese 5 por 0.01 y manda la orden. Al tendero le
-- llega un pedido por dos centimos con pinta de venir de Sevenz. El navegador
-- manda QUE producto, CUANTOS y EN QUE MONEDA; el importe se lee aqui de la
-- ficha.
--
-- ===========================================================================
-- LOS PRECIOS SE CONGELAN, Y NO ES REDUNDANCIA
--
-- Cada linea guarda el nombre y el importe tal como estaban al pedir, ademas
-- del `product_id`. Parece duplicar lo que ya esta en `products`, y no lo es:
--
--   Pedro pide dos aceites a 5 $. Esa noche Dona Rosa sube el aceite a 7 $. Si
--   la linea solo guardara «producto #12 x 2», al abrir la orden por la manana
--   diria 14 $ — y Pedro pidio por 10 $.
--
-- Una orden es la foto de lo acordado, no un enlace a un precio que se mueve.
-- Por eso `product_id` lleva `on delete set null`: si el producto se borra, la
-- linea sigue diciendo que se pidio y por cuanto.

begin;

-- ===========================================================================
-- 1. LA ORDEN
-- ===========================================================================

create table if not exists public.catalog_orders (
  id uuid primary key default gen_random_uuid(),

  owner_id uuid not null references public.owners (id) on delete cascade,

  -- POR QUE ENLACE ENTRO. `on delete set null` y no cascade: el dia que `MS-9`
  -- permita rotar el enlace del catalogo, rotarlo no puede borrar las ordenes
  -- que llegaron por el anterior.
  catalog_link_id uuid references public.catalog_share_links (id) on delete set null,

  -- QUIEN PIDE. Los tres obligatorios, decision del dueno el 2026-10-15, y se
  -- piden DESPUES de pulsar «Completar orden», no dentro del carrito.
  --
  -- Son datos de una persona que NO es usuaria de Sevenz, tecleados por ella
  -- misma. El documento es el mas sensible de los tres: es un identificador
  -- nacional, no un dato de contacto. Ver `CT-67` — la Politica de Privacidad
  -- tiene que salir con esto o miente desde el primer pedido.
  customer_name text not null check (btrim(customer_name) <> '' and length(customer_name) <= 120),
  customer_document text not null check (btrim(customer_document) <> '' and length(customer_document) <= 40),

  -- Normalizado por `normalize_whatsapp_phone`, nunca por quien llama. Se
  -- guarda el crudo tambien: el tendero va a verificarlo y puede corregirlo, y
  -- para eso necesita ver lo que el cliente escribio de verdad.
  customer_whatsapp text not null,
  customer_whatsapp_raw text not null,

  -- SI PIDIO RECIBIR AVISOS. La casilla del formulario. Se guarda aqui ademas
  -- de escribirse en `client_whatsapp_consents`, por dos razones: el tendero
  -- lo ve al abrir la orden —es parte de su doble verificacion, decision del
  -- dueno el 2026-10-15— y queda constancia de lo que se pidio aunque el
  -- permiso luego se revoque.
  wants_whatsapp_notices boolean not null default false,

  -- EN QUE ESTADO ESTA PARA EL TENDERO. Valores en ingles, que es la regla de
  -- CLAUDE.md para lo que se guarda: renombrar una cadena con `check` en
  -- produccion cuesta mucho mas que renombrar una variable.
  --
  -- `registered` es el estado al que llevara el boton de «registrar como fiado
  -- o venta» que el dueno todavia no ha decidido (2026-10-15). Existe desde ya
  -- para no tener que tocar el `check` con ordenes reales dentro.
  status text not null default 'new' check (status in ('new', 'seen', 'registered', 'discarded')),

  -- CUANDO EL TENDERO LA MIRO. Null mientras no. Es lo que deja contar
  -- «ordenes sin atender» sin inventarse nada.
  seen_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists catalog_orders_owner_idx
  on public.catalog_orders (owner_id, created_at desc);

-- EL INDICE DEL TOPE. La consulta caliente del candado 4: cuantas ordenes
-- lleva este enlace en el ultimo minuto.
create index if not exists catalog_orders_link_recent_idx
  on public.catalog_orders (catalog_link_id, created_at desc);

-- ===========================================================================
-- 2. LAS LINEAS
-- ===========================================================================

create table if not exists public.catalog_order_items (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.catalog_orders (id) on delete cascade,

  -- `set null` a proposito: ver la cabecera. La linea sobrevive al producto.
  product_id uuid references public.products (id) on delete set null,

  -- LA FOTO DE LO ACORDADO. Nombre e importe como estaban al pedir.
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 4) not null check (unit_price > 0),
  currency text not null check (currency in ('USD', 'EUR', 'USDT', 'COP', 'VES')),

  -- QUE ESCALON SE APLICO. Sin esto, una linea de 4 $ no se distingue de un
  -- descuento inventado: con el escalon, el tendero ve que fue el precio de
  -- mayor porque pidio seis.
  tier text not null check (tier in ('retail', 'wholesale')),

  -- EL COMENTARIO VA POR LINEA, no por orden. Decision del dueno el
  -- 2026-10-15: «el comentario viaja por producto individual».
  comment text check (comment is null or length(comment) <= 500),

  created_at timestamptz not null default now()
);

create index if not exists catalog_order_items_order_idx
  on public.catalog_order_items (order_id);

-- ===========================================================================
-- 3. RLS: ENCENDIDA, Y EL DUENO LEE LO SUYO
-- ===========================================================================

alter table public.catalog_orders enable row level security;
alter table public.catalog_order_items enable row level security;

drop policy if exists catalog_orders_owner_all on public.catalog_orders;
create policy catalog_orders_owner_all on public.catalog_orders
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists catalog_order_items_owner_all on public.catalog_order_items;
create policy catalog_order_items_owner_all on public.catalog_order_items
  for all using (
    exists (
      select 1 from public.catalog_orders o
      where o.id = order_id and o.owner_id = auth.uid()
    )
  );

-- `anon` NO TIENE NINGUN PERMISO SOBRE ESTAS TABLAS. Escribe solo a traves de
-- la funcion de abajo, que es `security definer`. Es la misma forma que
-- `whatsapp_sends`: la puerta es una funcion, no una tabla.
revoke all on public.catalog_orders from anon;
revoke all on public.catalog_order_items from anon;

-- ===========================================================================
-- 4. EL ORIGEN NUEVO DEL PERMISO
-- ===========================================================================

-- `client_order`: el permiso que entra por la casilla del carrito.
--
-- UN VALOR PROPIO Y NO REUTILIZAR `client_self`, aunque los dos los marque el
-- propio cliente. La diferencia importa el dia que algo salga mal: en
-- `/s/[token]` el numero lo habia escrito el TENDERO y el cliente solo
-- acepto; aqui lo teclea el visitante entero. Si alguna vez hay que encontrar
-- y revocar los permisos que entraron por esta puerta, esta columna es la
-- unica forma de distinguirlos. Y el panel de `MS-36` podra decir cuantos
-- vinieron de ordenes.
alter table public.client_whatsapp_consents
  drop constraint if exists client_whatsapp_consents_source_check;

alter table public.client_whatsapp_consents
  add constraint client_whatsapp_consents_source_check
  check (source in ('client_self', 'owner_movement_form', 'owner_import', 'owner_client_profile', 'client_order'));

-- ===========================================================================
-- 5. THE LEDGER ROW -- MISSING FROM THIS FILE UNTIL 2026-10-16
-- ===========================================================================

-- THIS FILE RAN IN DEV WITHOUT RECORDING ITSELF, and the row dev has today was
-- typed by hand afterwards. Caught by the `qa-regression-checklist` the day
-- before the catalogue was due to reach production, counting ledger inserts
-- across the twenty pending migrations: this was the only one of the twenty
-- with none.
--
-- WHAT IT WOULD HAVE COST, which is worse than it sounds: production would
-- have gained both tables and NOT the key. The checklist's hard stop compares
-- the two ledgers and blocks on any difference, so `108_ordenes_del_catalogo`
-- would have shown up as "dev has it, production does not" on every release
-- from then on -- a true-looking alarm about a migration that had in fact run.
-- An alarm that always rings stops being read, which is the exact failure
-- CLAUDE.md warns about for one-environment migrations.
--
-- The description below is copied CHARACTER FOR CHARACTER from the row dev
-- already holds, so that both environments say the same thing rather than two
-- accounts of the same migration.
insert into public.schema_migrations (key, description)
values (
  '108_ordenes_del_catalogo',
  'catalog_orders y catalog_order_items: las ordenes del catalogo publico, entregables C y D. Cada linea congela nombre e importe tal como estaban al pedir --una orden es la foto de lo acordado, no un enlace a un precio que se mueve-- y product_id lleva on delete set null para que la linea sobreviva al producto. RLS encendida y el dueno lee lo suyo; anon sin ningun permiso sobre las tablas, escribe solo por la funcion de la 109. Nuevo origen de permiso client_order, propio y no client_self: en /s/[token] el numero lo habia escrito el tendero, aqui lo teclea el visitante entero, y si algun dia hay que revocar los que entraron por esta puerta esa columna es la unica forma de distinguirlos.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Las dos tablas con RLS y su politica:
--
-- select t.tablename, t.rowsecurity, count(p.policyname) as politicas
-- from pg_tables t
-- left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
-- where t.schemaname = 'public' and t.tablename like 'catalog_order%'
-- group by t.tablename, t.rowsecurity;
--
-- EXPECTED: dos filas, rowsecurity = true, una politica cada una.
--
-- 2. Que `anon` no tenga NADA sobre ellas:
--
-- select table_name, grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name like 'catalog_order%' and grantee = 'anon';
--
-- EXPECTED: cero filas.
