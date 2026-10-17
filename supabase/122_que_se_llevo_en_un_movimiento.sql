-- 122: WHAT WAS TAKEN IN A MOVEMENT
--
-- Step 8 of the agreed order, the owner's deliverable `E` / `CT-51`: the
-- product selector inside the movement form. This is its half in the database.
--
-- ===========================================================================
-- THREE DECISIONS OF THE OWNER, taken on 2026-10-17 before a line was written,
-- because each one changes the shape of this table:
--
--   1. THE AMOUNT IS COMPUTED AND OVERRIDABLE. Picking 3 knives at $5 fills in
--      $15, and the shopkeeper may still leave it at $14 because he rounded or
--      gave a discount. So `movements.amount` stays the truth about the money
--      and these rows stay the truth about the goods -- they are allowed to
--      disagree, and the card shows the difference rather than hiding it.
--      Forcing them to match was the alternative, and it fails the day he
--      discounts: he goes back to not using products, or he writes the money
--      down wrong. Breaking the fiado record for a new feature is the worst
--      outcome available.
--
--   2. STOCK IS NOT TOUCHED HERE. This records WHAT was taken and how much;
--      nothing decrements `products.stock_opening`, which to this day is a
--      number nothing moves (see its own comment in `107`). The owner's
--      decision 4 of 2026-10-09 -- "if it carries a product, it discounts
--      stock" -- is deferred to its own step, not contradicted. Reason: the
--      movement dialog is the most fragile screen in the product (743 lines
--      and 18 states today, up from the 605 and 13 the plan describes), and
--      adding an event machine in the same step puts the fiado record at risk.
--
--   3. CHARGES ONLY. A payment is money coming in; nothing is carried out of
--      the shop. The check constraint cannot see `movements.type` from here,
--      so the guard lives in the server action AND in a trigger below -- the
--      second one because a constraint that only exists in TypeScript is one
--      migration away from not existing at all.
--
-- ===========================================================================
-- WHY A TABLE AND NOT A `jsonb` COLUMN ON `movements`
--
-- Because of the owner's decision 12 of 2026-10-09: when a movement that
-- created a product is deleted, he may also delete the product -- but only
-- when that movement is the ONLY one referencing it. Answering "who else uses
-- this product" against a jsonb column means scanning every movement of the
-- business; against a table it is one indexed lookup. The stock events of the
-- deferred step will hang off the same rows.
--
-- ===========================================================================
-- EVERY LINE CARRIES A SNAPSHOT, not just a product id. `name`, `quantity` and
-- `unit_price` are stored as they were at the moment of registering. If the
-- shopkeeper raises the price tomorrow, yesterday's fiado does not change --
-- the same reason a movement already seals its exchange rate. `product_id` is
-- there for the lookup above, and goes null if the product is ever hard
-- deleted, which keeps the history readable instead of taking it down with it.

begin;

create table if not exists public.movement_products (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements (id) on delete cascade,
  -- NULL is a real state, not a missing value: the product was deleted and the
  -- line still says what was taken. `on delete set null` and not `cascade`,
  -- because losing the product must never lose the record of the fiado.
  product_id uuid references public.products (id) on delete set null,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  -- Three decimals, same as `products.stock_opening`: 1,125 kilos is a real
  -- quantity in a bodega and rounding it to 1 would be inventing a sale.
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 1e9),
  -- In the MOVEMENT's currency. It is deliberately not repeated here: a line
  -- priced in a currency other than its own movement's is not a thing, and a
  -- second copy of that fact is a second thing that can disagree.
  unit_price numeric(14, 4) not null check (unit_price >= 0 and unit_price <= 1e11),
  created_at timestamptz not null default now()
);

create index if not exists movement_products_movement_idx
  on public.movement_products (movement_id);

-- THE INDEX THAT DECISION 12 NEEDS: "is this the only movement using this
-- product?". Without it that question scans the whole table every time a
-- movement is deleted.
create index if not exists movement_products_product_idx
  on public.movement_products (product_id)
  where product_id is not null;

comment on table public.movement_products is
  'Que se llevo el cliente en un movimiento. Una fila por producto. Guarda una FOTO del momento --nombre, cantidad y precio unitario-- asi que subir el precio manana no cambia el fiado de ayer. El precio va en la moneda del MOVIMIENTO. No descuenta stock: eso es un paso aparte (decision 4 del dueno del 2026-10-09, aplazada el 2026-10-17). Solo cargos, nunca abonos.';

-- ── Solo cargos, y no solo de palabra ───────────────────────────────────────
--
-- A check constraint cannot reach another table, so this is the only way to
-- say it in the database. The server action says it too; this is what keeps it
-- true when somebody writes a second server action in six months.
create or replace function public.movement_products_solo_cargos()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select m.type into v_type from public.movements m where m.id = new.movement_id;
  if v_type is distinct from 'charge' then
    raise exception 'Solo un fiado puede llevar productos.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists movement_products_solo_cargos on public.movement_products;
create trigger movement_products_solo_cargos
  before insert or update on public.movement_products
  for each row execute function public.movement_products_solo_cargos();

-- ── RLS, Y LOS GRANTS QUE LA `108` SE DEJO ──────────────────────────────────
--
-- Una politica correcta sin grant NO SE CONSULTA SIQUIERA: Postgres responde
-- 42501 antes de llegar a ella. Eso es exactamente lo que le paso a
-- `catalog_orders` en la `108` -- la pantalla de Pedidos decia que no habia
-- llegado ninguno con las ordenes guardadas dentro, y la suite pasaba en verde
-- porque corre con la clave de servicio, que ni usa RLS ni necesita permisos.
-- Lo arreglo la `116`, ayer. Por eso los grants van aqui, al lado de la
-- politica, y por eso `qa/productos-del-movimiento.mjs` lee como el DUENO.
alter table public.movement_products enable row level security;

drop policy if exists "owners read own movement products" on public.movement_products;
drop policy if exists "owners insert own movement products" on public.movement_products;
drop policy if exists "owners delete own movement products" on public.movement_products;

create policy "owners read own movement products" on public.movement_products
  for select using (
    exists (
      select 1
      from public.movements m
      join public.clients c on c.id = m.client_id
      where m.id = movement_id and c.owner_id = auth.uid()
    )
  );

-- INSERT y DELETE llevan `owner_puede_escribir`, igual que `movements`: una
-- cuenta bloqueada no puede cambiar lo que dice un fiado.
create policy "owners insert own movement products" on public.movement_products
  for insert with check (
    exists (
      select 1
      from public.movements m
      join public.clients c on c.id = m.client_id
      where m.id = movement_id and c.owner_id = auth.uid()
    )
    and public.owner_puede_escribir(auth.uid())
  );

create policy "owners delete own movement products" on public.movement_products
  for delete using (
    exists (
      select 1
      from public.movements m
      join public.clients c on c.id = m.client_id
      where m.id = movement_id and c.owner_id = auth.uid()
    )
    and public.owner_puede_escribir(auth.uid())
  );

-- NO HAY `update`, y es deliberado: una linea se corrige borrandola y
-- escribiendola de nuevo, que es lo que hace el formulario. Una politica que
-- nadie usa es una puerta que nadie vigila.
grant select, insert, delete on public.movement_products to authenticated;
revoke all on public.movement_products from anon;

insert into public.schema_migrations (key, description)
values (
  '122_que_se_llevo_en_un_movimiento',
  'movement_products: que se llevo el cliente en un movimiento, una fila por producto, con una FOTO del momento (nombre, cantidad y precio unitario) para que subir el precio manana no cambie el fiado de ayer. Es la mitad de base del paso 8, el entregable E / CT-51. Tres decisiones del dueno del 2026-10-17 la moldean: (1) el monto se calcula desde los productos pero SE PUEDE CORREGIR, asi que movements.amount sigue siendo la verdad del dinero y estas filas la de la mercancia, y se les permite discrepar porque forzarlas a cuadrar falla el dia que el tendero haga un descuento; (2) NO descuenta stock -- la decision 4 del 2026-10-09 se aplaza a su propio paso, no se contradice, porque el dialogo de movimiento es la pantalla mas fragil del producto y meterle una maquina de eventos en el mismo paso pone en riesgo el registro de fiados; (3) solo cargos, nunca abonos, y lo dice un trigger ademas del codigo. Tabla y no jsonb porque la decision 12 necesita preguntar quien mas usa un producto, que en jsonb es recorrer todos los movimientos del negocio. Los grants van al lado de la politica a proposito: una politica sin grant ni se consulta, que es lo que le paso a catalog_orders en la 108.'
)
on conflict (key) do nothing;

commit;
