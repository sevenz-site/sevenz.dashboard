-- ===========================================================================
-- THE PRODUCT COUNT GOES DOWN WITH EVERY SALE
--
-- Owner's decision, 2026-10-27, asked before building because the Inventario
-- tab of Reportes could not be built honestly without it:
-- *«Actualicemos para que la cantidad de productos se descuenta con cada venta
-- y sacamos la data de allí»*.
--
-- ---------------------------------------------------------------------------
-- THIS DISPLACES A DECISION WRITTEN IN MIGRATION 084, AND THAT IS SAID OUT LOUD
--
-- That migration named the column `stock_opening` on purpose, and wrote why:
--
--   «Por eso se llama stock_opening y no stock: un nombre que prometa "el
--    stock de ahora" seria mentira el dia que exista el calculo de verdad, y
--    lo peor de un nombre asi es que nadie lo cambia.»
--
-- The reasoning was right while nothing maintained the number. From this
-- migration on, every sale maintains it, so the column holds the CURRENT
-- quantity and the old name is the only thing left that is wrong.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN IS NOT RENAMED, WHICH IS THE OBVIOUS THING TO WANT
--
-- `CLAUDE.md` fixes the deploy order: migrations reach production FIRST, code
-- second. A rename would make every current reader fail the moment this runs
-- --`get_shared_catalog`, `get_shared_product`, the cart, the product sheet,
-- six SQL functions and about a dozen call sites-- so production would be down
-- in the window between the two deploys. Keeping the name degrades gracefully
-- instead: old code reading `stock_opening` keeps working and simply starts
-- reading a better number.
--
-- It also keeps ONE truth. Adding `stock_qty` beside it would leave the public
-- catalogue showing the opening count while Reportes showed the live one --
-- two numbers for the same shelf, and the client holding the phone sees the
-- stale one.
--
-- ---------------------------------------------------------------------------
-- NULL STAYS NULL. THIS IS THE DANGEROUS PART.
--
-- Migration 107 made the difference between NULL and 0 publicly visible:
-- `> 0` is «Disponible: NN» in green, `0` is «No disponible» in RED, and NULL
-- is «Disponible» with no figure. It ends with a warning this migration has to
-- obey: *«este campo no se puede empezar a rellenar con un default: un 0
-- puesto por comodidad apagaria el producto en el catalogo de alguien»*.
--
-- So a product whose quantity was never counted is NEVER touched by the
-- trigger. Selling it does not create a 0 out of nowhere -- that 0 would read,
-- to the shopkeeper's customer, as «sold out» for something sitting on the
-- shelf.
--
-- ---------------------------------------------------------------------------
-- PAST SALES ARE NOT SUBTRACTED. The count starts being maintained today.
--
-- Subtracting history would need a purchase ledger to add the restocks back,
-- and there is none. Without it every product would drop by everything ever
-- sold and land at zero. What the shopkeeper typed is the truth as of the day
-- he typed it; from today the app keeps it up to date.
--
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. HOW MUCH THIS LINE ACTUALLY TOOK OFF THE SHELF
--
-- Not the same as `quantity`, and the difference is what makes undo correct.
-- Selling 5 of something with 3 counted leaves the count at 0, not at -2: a
-- negative quantity is published to the catalogue by the functions above and
-- reads as a broken app. So the trigger clamps.
--
-- But a clamp without memory is not reversible: deleting that sale would add 5
-- back to a shelf that only ever had 3. This column remembers that only 3 were
-- taken, so putting them back is exact.
--
-- NULL means «this line never moved stock» -- no product, or a product with no
-- counted quantity. It is not 0: 0 means «it moved nothing because there was
-- nothing left», which is a different fact.
alter table public.sale_lines
  add column if not exists stock_taken numeric(14, 3);

comment on column public.sale_lines.stock_taken is
  'Cuanto descontó esta línea de products.stock_opening, que NO es lo mismo que quantity: si el producto tenía menos de lo vendido, aquí queda lo que de verdad había. Es lo que se devuelve al borrar la venta, y sin ello un borrado dejaría en la estantería más de lo que nunca hubo. NULL es «esta línea no movió inventario» (sin producto, o producto sin cantidad contada), que no es lo mismo que 0.';

-- ---------------------------------------------------------------------------
-- 2. A PARTIR DE CUANTO AVISAR. Decision del dueno el 2026-10-27: arranca en 5
-- y es ajustable, *«para que lo muevas si no te sirve»*.
--
-- Vive en `owners` y no en cada producto, que era la tercera opcion que se le
-- ofrecio: un umbral por producto es mas fiel a una bodega de verdad --la
-- harina avisa a 20 y el detergente a 2-- y cuesta un campo mas en un
-- formulario que ya es largo. Si algun dia hace falta, la columna por producto
-- se anade al lado y esta pasa a ser el valor por defecto.
alter table public.owners
  add column if not exists low_stock_threshold integer not null default 5;

alter table public.owners drop constraint if exists owners_low_stock_threshold_range;
alter table public.owners add constraint owners_low_stock_threshold_range
  -- Cero significa «no me avises», que es una respuesta legitima. El techo
  -- evita un numero absurdo que marcara el catalogo entero como «por agotarse»
  -- y convertiria la tarjeta en ruido.
  check (low_stock_threshold >= 0 and low_stock_threshold <= 10000);

comment on column public.owners.low_stock_threshold is
  'A partir de cuántas unidades un producto cuenta como «por agotarse» en Reportes → Inventario. Decisión del dueño el 2026-10-27: arranca en 5 y es ajustable. Cero es «no me avises».';

-- ---------------------------------------------------------------------------
-- 3. EL DESCUENTO
--
-- EN UN DISPARADOR Y NO EN LA ACCION DE SERVIDOR, y es deliberado. `CLAUDE.md`
-- tiene escrita la regla que lo exige: *«un campo nuevo entra por TODAS las
-- puertas de su accion»*, y una venta hoy entra por dos --`registrarVenta` y
-- `registrarPedidoComoVenta`-- con una tercera prevista. Un disparador sobre
-- `sale_lines` las cierra todas de golpe, incluida la que alguien escriba
-- manana sin saber que esto existe.

create or replace function public.apply_sale_line_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_disponible numeric(14, 3);
  v_tomado numeric(14, 3);
begin
  if new.product_id is null then
    return new;
  end if;

  -- SE BLOQUEA LA FILA. Dos ventas simultáneas del mismo producto leerían la
  -- misma cantidad y las dos restarían de ella, así que una de las dos no se
  -- descontaría nunca. Es poco probable en una bodega y es gratis evitarlo.
  select stock_opening into v_disponible
  from public.products
  where id = new.product_id
  for update;

  -- Sin cantidad contada no se inventa una. Ver la cabecera: un 0 nacido aquí
  -- apaga el producto en el catálogo público.
  if v_disponible is null then
    return new;
  end if;

  v_tomado := least(new.quantity, v_disponible);

  update public.products
     set stock_opening = v_disponible - v_tomado,
         updated_at = now()
   where id = new.product_id;

  -- SE ESCRIBE EN LA FILA QUE SE ACABA DE INSERTAR, y por eso este disparador
  -- es AFTER y no BEFORE: en BEFORE bastaría con `new.stock_taken := …`, pero
  -- entonces el `select … for update` de arriba correría antes de que la línea
  -- exista y dos inserciones del mismo lote podrían cruzarse.
  update public.sale_lines
     set stock_taken = v_tomado
   where id = new.id;

  return new;
end;
$$;

comment on function public.apply_sale_line_stock() is
  'Descuenta del inventario lo que se lleva una línea de venta, y anota en stock_taken cuánto se llevó de verdad. Un producto sin cantidad contada no se toca NUNCA: ver 107, donde un 0 inventado apaga el producto en el catálogo público.';

drop trigger if exists sale_line_takes_stock on public.sale_lines;
create trigger sale_line_takes_stock
  after insert on public.sale_lines
  for each row execute function public.apply_sale_line_stock();

-- ---------------------------------------------------------------------------
-- 4. LA DEVOLUCION
--
-- `eliminarVenta` borra EN BLANDO --pone `sales.deleted_at` y no toca
-- `sale_lines`-- así que un disparador de borrado sobre las líneas no se
-- enteraría nunca. Lo que hay que vigilar es esa columna.
--
-- Y VA EN LOS DOS SENTIDOS: restaurar una venta vuelve a descontar. Sin esa
-- mitad, borrar y restaurar sería una forma silenciosa de fabricar mercancía.

create or replace function public.apply_sale_stock_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signo integer;
begin
  -- Solo cuando el estado de borrado CAMBIA. Un `update` que toque cualquier
  -- otra columna de `sales` no puede mover inventario.
  if (old.deleted_at is null) = (new.deleted_at is null) then
    return new;
  end if;

  -- Se borra -> se devuelve (+1). Se restaura -> se vuelve a descontar (-1).
  v_signo := case when new.deleted_at is not null then 1 else -1 end;

  if v_signo = 1 then
    -- DEVOLVER LO QUE SE LLEVO, no la cantidad vendida. Es para lo que existe
    -- `stock_taken`: una venta de 5 sobre una estantería de 3 devuelve 3.
    update public.products p
       set stock_opening = p.stock_opening + l.stock_taken,
           updated_at = now()
      from public.sale_lines l
     where l.sale_id = new.id
       and l.product_id = p.id
       and l.stock_taken is not null
       and p.stock_opening is not null;
  else
    -- AL RESTAURAR SE VUELVE A CLAMPAR, porque entre el borrado y la
    -- restauración pudo venderse lo mismo otra vez.
    update public.products p
       set stock_opening = greatest(0, p.stock_opening - l.stock_taken),
           updated_at = now()
      from public.sale_lines l
     where l.sale_id = new.id
       and l.product_id = p.id
       and l.stock_taken is not null
       and p.stock_opening is not null;
  end if;

  return new;
end;
$$;

comment on function public.apply_sale_stock_on_delete() is
  'Devuelve al inventario lo que una venta se llevó cuando esa venta se borra en blando, y lo vuelve a descontar si se restaura. Mira sales.deleted_at porque eliminarVenta no borra las líneas. Devuelve stock_taken y no quantity: una venta de 5 sobre una estantería de 3 devuelve 3.';

drop trigger if exists sale_deletion_returns_stock on public.sales;
create trigger sale_deletion_returns_stock
  after update of deleted_at on public.sales
  for each row execute function public.apply_sale_stock_on_delete();

-- ---------------------------------------------------------------------------
-- 5. EL BORRADO DURO DE UNA LINEA, que hoy no ocurre y manana puede.
--
-- `sale_lines` no tiene `deleted_at` y nada la borra en duro ahora mismo --lo
-- dice `ventas/actions.ts` por escrito-- pero una línea que desaparezca sin
-- devolver su mercancía es exactamente el fallo mudo que esta migración existe
-- para cerrar. Cuesta seis líneas.
create or replace function public.return_sale_line_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.product_id is null or old.stock_taken is null then
    return old;
  end if;
  update public.products
     set stock_opening = stock_opening + old.stock_taken,
         updated_at = now()
   where id = old.product_id
     and stock_opening is not null;
  return old;
end;
$$;

drop trigger if exists sale_line_returns_stock on public.sale_lines;
create trigger sale_line_returns_stock
  after delete on public.sale_lines
  for each row execute function public.return_sale_line_stock();

-- ---------------------------------------------------------------------------
-- 6. NO SE RECALCULA NADA HACIA ATRAS. Ver la cabecera: sin un registro de
-- compras no hay forma de devolver las reposiciones, así que restar el
-- histórico dejaría todo el catálogo en cero. Las ventas anteriores a esta
-- migración quedan con `stock_taken` NULO, que es la verdad: no movieron
-- inventario, porque cuando ocurrieron esto no existía.

insert into public.schema_migrations (key, description)
values (
  '163_el_inventario_baja_con_cada_venta',
  'La cantidad de un producto se descuenta con cada venta y se devuelve al borrarla. Decisión del dueño el 2026-10-27. Desplaza lo escrito en la 084 sobre el nombre stock_opening: la columna pasa a ser la cantidad ACTUAL y no se renombra porque el renombrado rompería producción entre el despliegue de la migración y el del código. Un producto sin cantidad contada no se toca nunca (ver 107). Añade owners.low_stock_threshold, que arranca en 5.'
)
on conflict (key) do nothing;
