-- THE SALE. Sevenz stops being only a book of what people owe and starts
-- recording what it sells.
--
-- Owner's commission of 2026-10-17, sitemap `1269:6051`, and three decisions
-- he took the same day after reading what each one costs. They are written
-- here because this migration is the shape they take.
--
-- ===========================================================================
-- DECISION 1 — A CASH SALE IS NOT A FIADO, AND IT NEVER TOUCHES `movements`
--
-- His words: «Marcaría como venta, no como fiado».
--
-- THE LEDGER DECIDED THE SHAPE. `recalc_client_running_balance` walks every
-- movement and does `running += (type = 'charge' ? +amount : -amount)`. There
-- is no neutral row: a `type = 'sale'` would be read as a payment and would
-- SUBTRACT from the balance. Teaching that function to skip rows means
-- editing what computes every client's balance, which is the last function in
-- this product anybody should touch for a feature.
--
-- So a sale that was paid in full writes NOTHING into `movements`. And with
-- that, his decision implements itself: `lib/credit-score.ts` and
-- `lib/lending-charts.ts` read movements, so they never see a cash sale --
-- no filter to add, no flag to respect, nothing to forget.
--
-- WHAT A PART-PAID SALE WRITES IS THE REMAINDER, NOT THE TOTAL. His example:
-- «una compra por 10 USD puede abonar 5 y quedar debiendo 5». Those 5 are the
-- charge, with their own `plazo_dias` and `cuotas`. The 10 never enter the
-- ledger as a debt, because 10 was never owed. That is also exactly what the
-- sitemap's «Debe (esta venta)» shows.
--
-- AND THE TILL PAYMENT CANNOT BE A `movement`, which is arithmetic and not
-- taste: with no charge beside it, a payment row drives the balance negative
-- and the client shows as having money in his favour. It lives in
-- `sale_payments`.
--
-- ===========================================================================
-- DECISION 2 — NO USDT. NOT YET.
--
-- `movements.currency` admits only `USD` and `EUR`, `entry_currency` admits
-- `VES/USD/EUR`, there is no `balance_usdt`, and the lock from step 1 still
-- REFUSES selling in USDT (`isSaleCurrencyLocked`) -- refuses rather than
-- filters, so a product is never silently repriced.
--
-- The sitemap draws a «Total en USDT» card with its own pay button. It
-- assumes step 11, which the agreed order puts last and `CT-79` says is not
-- negotiable. So the currencies below stop at what the book can store. USDT
-- comes back with its step, and the `check` constraints here are what make
-- that a loud failure instead of a quiet one.
--
-- ===========================================================================
-- DECISION 3 — THE CLIENT IS OPTIONAL IN A CASH SALE, VIA A WALK-IN CLIENT
--
-- `movements.client_id` is `not null`, and -- this is the part that decided
-- it -- the RLS policy on `movements` derives the owner ENTIRELY through the
-- client: `exists (select 1 from clients c where c.id = client_id and
-- c.owner_id = auth.uid())`. A movement with no client would have no owner as
-- far as the database is concerned: invisible to its own shopkeeper.
--
-- Making it nullable means adding `owner_id` to `movements` and rewriting the
-- policies of a live money table. A walk-in client costs one flag and the
-- discipline of excluding it from every list -- see `CT-99`.
--
-- ===========================================================================
-- AND THIS SUPERSEDES `movement_products` (migration 122), WHICH NEVER
-- REACHED PRODUCTION
--
-- 122 hung the product lines off the movement. A cash sale has no movement,
-- so its products had nowhere to live, and the alternative was two tables
-- answering «qué se llevó el cliente» -- two queries, and every screen either
-- reading both or being quietly half right.
--
-- The owner chose to unify on 2026-10-17, and the timing is the whole point:
-- 122 is in `dev` only. Changing it today costs a migration. Changing it
-- after it ships costs migrating rows of real customers.
--
-- So a MANUAL FIADO IS NOW A SALE WITH NO PAYMENT, and every line a client
-- takes away lives in `sale_lines`. One table, one query, one screen.

begin;

-- ── 0. The walk-in client ──────────────────────────────────────────────
--
-- ONE PER BUSINESS, CREATED ON DEMAND BY THE APP, never by this migration:
-- creating 24 rows for businesses that may never make a cash sale is 24 rows
-- somebody has to explain later.
--
-- The flag is what every list has to exclude -- clients, cartera, credit
-- score, WhatsApp reminders, the shared link. `CT-99` holds that audit, and
-- it is the known cost of this option: forget one and the shopkeeper sees
-- «Mostrador» among his clients carrying a balance.
alter table public.clients
  add column if not exists is_walk_in boolean not null default false;

-- Uno por negocio, y la base lo garantiza: si el alta se intentara dos veces
-- a la vez -- dos ventas de mostrador simultáneas en dos pestañas -- la
-- segunda falla aquí en vez de dejar dos mostradores con saldos distintos.
create unique index if not exists clients_one_walk_in_per_owner
  on public.clients (owner_id)
  where is_walk_in;

-- ── 1. The sale ────────────────────────────────────────────────────────
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  -- `owner_id` DIRECTLY, and not derived through the client the way
  -- `movements` does it. That chain is what makes a client-less movement
  -- unreachable (decision 3), and there is no reason to repeat it in a table
  -- being written from scratch: a sale belongs to a business, and saying so
  -- makes its RLS one condition instead of a join.
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- NOT NULL even for a walk-in sale: that one points at the business's
  -- walk-in client. Nullable here would reopen decision 3 through the back
  -- door, because `movements.sale_id` leads back to this row.
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Quién la registró, igual que `movements.created_by` (migración 049).
  created_by uuid,
  note text check (note is null or length(note) <= 500),
  -- La papelera, igual que en `movements`: una venta se retira, no se borra.
  deleted_at timestamptz
);

create index if not exists sales_owner_idx
  on public.sales (owner_id, created_at desc)
  where deleted_at is null;
create index if not exists sales_client_idx
  on public.sales (client_id, created_at desc)
  where deleted_at is null;

-- ── 2. What the client took ────────────────────────────────────────────
create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  -- `set null` AND NOT `cascade`: the day the shopkeeper deletes a product
  -- from his catalogue, what he sold does not disappear from his books. The
  -- name and the price below are sealed for exactly that reason.
  product_id uuid references public.products (id) on delete set null,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 1e9),
  unit_price numeric(14, 4) not null check (unit_price >= 0 and unit_price <= 1e11),
  -- LA MONEDA ES POR LÍNEA, que es lo que el carrito del sitemap permite
  -- cambiar con su «Cambiar». Sin USDT (decisión 2). `COP` es el libro de un
  -- negocio colombiano, que en `movements` se guarda como `currency = null`.
  currency text not null check (currency in ('USD', 'EUR', 'COP')),
  tier text check (tier is null or tier in ('retail', 'wholesale')),
  comment text check (comment is null or length(comment) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists sale_lines_sale_idx on public.sale_lines (sale_id);
-- Para la pregunta «cuánto he vendido de esto», que es la que el inventario
-- va a hacer cuando llegue (`CT-91`).
create index if not exists sale_lines_product_idx
  on public.sale_lines (product_id)
  where product_id is not null;

-- ── 3. What was collected at the till ──────────────────────────────────
create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  -- EL LIBRO AL QUE SE ABONA, no necesariamente lo que el cliente entregó.
  currency text not null check (currency in ('USD', 'EUR', 'COP')),
  amount numeric(14, 4) not null check (amount > 0 and amount <= 1e11),
  -- LO QUE DE VERDAD SE TECLEÓ, y existe por la misma razón escrita en la
  -- migración `022` para los movimientos: en una disputa, el registro
  -- defendible es lo que el cliente entregó, no la cifra derivada después.
  -- El sitemap lo pide literalmente -- «Monto» en bolívares y «Equivalencia»
  -- en dólares.
  entry_currency text check (entry_currency is null or entry_currency in ('VES', 'USD', 'EUR', 'COP')),
  entry_amount numeric(14, 4) check (entry_amount is null or entry_amount > 0),
  -- La tasa con la que se hizo esa conversión, congelada. Sin esto, la
  -- equivalencia de hace tres meses se recalcula con la tasa de hoy y el
  -- recibo deja de cuadrar consigo mismo.
  rate_used numeric(18, 8) check (rate_used is null or rate_used > 0),
  photo_path text,
  description text check (description is null or length(description) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);

-- ── 4. The ledger learns about the sale ────────────────────────────────
--
-- `sale_id` ON THE CHARGE, para que el fiado sepa de qué compra nació. Es lo
-- que `CT-100` pedía poner ANTES de que existan ventas: retrofitearlo después
-- sería migrar filas vivas de dinero.
--
-- `on delete set null` y no `cascade`: retirar una venta no puede llevarse
-- por delante una deuda que el cliente sigue teniendo. Lo que se haga con esa
-- deuda es una decisión del tendero, no un efecto colateral.
alter table public.movements
  add column if not exists sale_id uuid references public.sales (id) on delete set null;

create index if not exists movements_sale_idx
  on public.movements (sale_id)
  where sale_id is not null;

-- ── 5. Abonar a un fiado CONCRETO ──────────────────────────────────────
--
-- Pedido por el dueño el 2026-10-17: «esos 5 que queda debiendo deben entrar
-- como fiado + plazo de pago + cuota y poderse pagar seleccionando
-- precisamente ese fiado, tipo conciliación». Es la mitad de `CT-77` que
-- faltaba, y la columna que el paso 9 del plan dice que no existe.
--
-- NADA LA LEE TODAVÍA, Y ESO ES DELIBERADO. El reparto de abonos lo hace hoy
-- `get_oldest_unpaid_charge_for_currency` por orden FIFO, y `credit-score.ts`
-- repite ese mismo recorrido en TypeScript. Enseñarles a respetar un abono
-- dirigido cambia cómo se juzga el estado de TODOS los clientes, así que va
-- en su propio trabajo, con sus propias pruebas. La columna se añade aquí
-- porque es barata ahora y porque el modelo queda completo.
alter table public.movements
  add column if not exists applies_to_movement_id uuid references public.movements (id) on delete set null;

create index if not exists movements_applies_to_idx
  on public.movements (applies_to_movement_id)
  where applies_to_movement_id is not null;

-- ── 6. Un producto de otro negocio no entra en una venta ───────────────
--
-- LA MISMA CLASE DE CANDADO que la `122` ponía sobre `movement_products`, y
-- por la misma razón: `product_id` llega desde el navegador. La RLS protege
-- la FILA, no lo que esa fila apunta -- un dueño puede insertar en SU venta
-- una línea que referencia el producto de otro, y nada en la política lo
-- impide porque la política solo mira de quién es la venta.
create or replace function public.sale_lines_producto_propio()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner_venta uuid;
  v_owner_producto uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select owner_id into v_owner_venta from public.sales where id = new.sale_id;
  select owner_id into v_owner_producto from public.products where id = new.product_id;

  if v_owner_producto is distinct from v_owner_venta then
    raise exception 'producto_de_otro_negocio' using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

drop trigger if exists sale_lines_producto_propio on public.sale_lines;
create trigger sale_lines_producto_propio
  before insert or update on public.sale_lines
  for each row execute function public.sale_lines_producto_propio();

-- ── 7. RLS y GRANTS ────────────────────────────────────────────────────
--
-- LOS GRANTS NO SON OPCIONALES Y ESTA MIGRACIÓN NO SE ESCRIBE SIN ELLOS. La
-- `108` creó `catalog_orders` con RLS y una política correcta y SIN conceder
-- nada a `authenticated`: cada lectura del tendero murió con `42501`, la
-- pantalla de Pedidos dijo «todavía no te ha llegado ningún pedido» con tres
-- pedidos dentro, y `qa:pedidos` pasaba 14 de 14 en ese mismo momento. Lo
-- arregló la `116`. Una política no se consulta si el rol no tiene permiso
-- sobre la tabla.
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_payments enable row level security;

drop policy if exists "owners manage own sales" on public.sales;
create policy "owners manage own sales" on public.sales
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owners manage own sale lines" on public.sale_lines;
create policy "owners manage own sale lines" on public.sale_lines
  for all
  using (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()));

drop policy if exists "owners manage own sale payments" on public.sale_payments;
create policy "owners manage own sale payments" on public.sale_payments
  for all
  using (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()));

grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.sale_lines to authenticated;
grant select, insert, update, delete on public.sale_payments to authenticated;

-- `anon` NO TOCA NADA DE ESTO. El catálogo público crea órdenes, no ventas:
-- una venta la registra el tendero con su sesión. Lo que un desconocido puede
-- escribir sigue siendo exactamente `create_catalog_order` y nada más.
revoke all on public.sales from anon;
revoke all on public.sale_lines from anon;
revoke all on public.sale_payments from anon;

-- ── 8. Fuera `movement_products` ───────────────────────────────────────
--
-- Superseded by `sale_lines`.
--
-- `if exists` PORQUE PUEDE HABER O NO HABER TABLA QUE BORRAR, y las dos cosas
-- son correctas. Esta línea decía que en producción «nunca llegó a existir»,
-- porque el plan era registrar allí la `122` como no-op. El 2026-10-21 se
-- desplegó el lote entero en orden y la `122` se ejecutó de verdad también en
-- producción: la tabla existió unos minutos y esta migración la borró, que es
-- exactamente el camino que dev había recorrido. El estado final es el mismo
-- por los dos caminos, y por eso no se corrigió sobre la marcha.
--
-- Lo que queda en los dos ledgers es la clave `122` con la descripción de una
-- tabla que ya no existe. Eso es deliberado y no se toca: la comparación de
-- ledgers del `qa-regression-checklist` compara CLAVES, la clave tiene que
-- estar en ambos lados para que coincidan, y reescribir la descripción a
-- posteriori haría que el apunte dejara de decir lo que de verdad se ejecutó.
drop trigger if exists movement_products_solo_cargos on public.movement_products;
drop table if exists public.movement_products;
drop function if exists public.movement_products_solo_cargos();

comment on table public.sales is
  'Una venta del tendero: qué se llevó el cliente y qué pagó en el momento. Una venta PAGADA no escribe nada en movements -- recalc_client_running_balance no tiene fila neutra y un type nuevo restaría del saldo--, y por eso el puntaje de credito y las graficas de fiado no la ven sin necesidad de filtrarla. Una venta a credito escribe en movements un cargo por LO QUE QUEDA, nunca por el total, con su plazo y sus cuotas. Un fiado manual es una venta sin pago: desde 2026-10-17 todas las lineas de producto viven en sale_lines, que sustituye a movement_products (122, que nunca llego a produccion).';

insert into public.schema_migrations (key, description)
values (
  '124_la_venta',
  'LA VENTA: sales, sale_lines y sale_payments, mas movements.sale_id y movements.applies_to_movement_id, y clients.is_walk_in. Sevenz deja de ser solo un libro de deudas y registra lo que vende. · Una venta PAGADA no escribe nada en movements, porque recalc_client_running_balance no tiene fila neutra: un type nuevo seria leido como abono y restaria del saldo. Con eso el contado no entra en el puntaje de credito ni en las graficas de fiado sin tener que filtrarlo en ningun sitio. · Una venta a credito escribe un cargo por LO QUE QUEDA -- «una compra por 10 USD puede abonar 5 y quedar debiendo 5», palabras del dueno-- con su plazo y sus cuotas. · El pago del mostrador NO puede ser un movement: sin cargo al lado dejaria el saldo en negativo. · SIN USDT por decision del dueno: movements.currency solo acepta USD y EUR y el candado del paso 1 sigue puesto; vuelve con el paso 11 (CT-79). · El cliente es opcional en el contado via clients.is_walk_in, porque la RLS de movements deriva el dueno ENTERAMENTE a traves del cliente y un movimiento sin cliente seria invisible para su propio tendero (CT-99). · SUSTITUYE A LA 122: movement_products se borra y sus lineas pasan a sale_lines, porque una venta pagada no tiene movimiento del que colgar. Se hace hoy porque la 122 esta solo en dev; despues seria migrar filas de clientes reales. · applies_to_movement_id la LEE NADIE todavia: el abono dirigido cambia como se juzga el estado de todos los clientes y va en su propio trabajo (CT-77, paso 9).'
)
on conflict (key) do nothing;

commit;
