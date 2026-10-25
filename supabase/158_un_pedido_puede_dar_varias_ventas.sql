-- ═══════════════════════════════════════════════════════════════════════
-- ONE ORDER, ONE SALE PER CURRENCY
--
-- The owner's decision of 2026-10-25, answering how a two-currency order is
-- registered: *«dos ventas pero el cliente se guarda al final de la primera
-- venta y se usa para la segunda venta»*. It is what the new flow's own
-- arrows draw — after paying the first currency the shopkeeper passes
-- through «4/4 Información del cliente», and the next currency restarts the
-- same flow at 3/3 «porque la pantalla de Registrar cliente ya no se muestra
-- porque registró el cliente en el primer pedido».
--
-- ───────────────────────────────────────────────────────────────────────
-- WHY `catalog_orders.sale_id` COULD NOT CARRY THIS, AND IT IS NOT A BUG
--
-- Migration `157`, written the day before, gave `catalog_orders` a single
-- `sale_id` plus `catalog_orders_sale_id_unico`. That was correct for the
-- flow as it was designed then: one order produced one sale, because the
-- registration was per PRODUCT and every product ended in the same sale.
--
-- `CT-147` changed the shape of the flow, not the shape of the data — and
-- then the data stopped fitting. A uuid column holds one value; an order
-- with dollars and euros now produces two sales. Forcing them into one was
-- the alternative and it was put to the owner with its cost; he chose two,
-- and the reason is in the flow: the first sale is what creates the client,
-- and the second one needs that client to already exist.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHAT EACH COLUMN MEANS FROM NOW ON, because there are now two links
--
-- `sales.catalog_order_id`  THE REAL LINK. Every sale born from an order
--                           carries it. Many sales may share one order —
--                           one per currency — so there is no unique index
--                           here, deliberately.
--
-- `catalog_orders.sale_id`  THE FIRST SALE, and it stays. Its unique index
--                           still says something true and worth keeping: no
--                           two ORDERS may claim the same sale. What it
--                           stops being is «the» sale of the order.
--
-- IT IS NOT DROPPED, and that is a decision: the order's detail screen and
-- `registrarVenta`'s hard stop both read it today, and emptying it in the
-- same migration that adds the new link would break a screen that is live
-- in dev for no gain. The code moves to `catalog_order_id` first; the day
-- nothing reads `sale_id` any more it can go, and that day is a migration
-- of its own with nothing else in it.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHAT «REGISTERED» MEANS NOW, and it is NOT enforced here
--
-- An order is finished when EVERY currency of its lines has a sale. That is
-- derived — a currency is registered when some sale of this order carries a
-- line in it — so there is no column for it and nothing to keep in sync.
-- `catalog_orders.status` and `registered_at` are stamped by the code when
-- the last currency lands, not by the first.
--
-- A CHECK CONSTRAINT WAS CONSIDERED AND LEFT OUT: expressing «all currencies
-- covered» in SQL needs a query over three tables, which a check cannot do,
-- and a trigger that recomputes it on every `sale_lines` insert would run on
-- every ordinary sale in the app to serve the handful born from an order.
--
-- ───────────────────────────────────────────────────────────────────────
-- WORST CASE THIS LEAVES OPEN, said out loud rather than papered over
--
-- The shopkeeper registers dollars and walks away. The dollars sale EXISTS —
-- that is the point of two sales, the money he already took is written down
-- — and the order still shows euros as pending. Nothing is lost and nothing
-- is double counted. What he must never see is the order looking finished
-- with one currency missing, and that is the code's job, checked by
-- `qa/pedido-registro.mjs`.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.sales
  add column if not exists catalog_order_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_catalog_order_id_fkey'
      and conrelid = 'public.sales'::regclass
  ) then
    alter table public.sales
      add constraint sales_catalog_order_id_fkey
      foreign key (catalog_order_id) references public.catalog_orders (id) on delete set null;
  end if;
end
$$;

-- NOT UNIQUE, and that is the whole migration in one line: an order with two
-- currencies produces two rows here.
create index if not exists sales_catalog_order_id_idx
  on public.sales (catalog_order_id)
  where catalog_order_id is not null;

-- The orders already registered in dev under the per-product flow. They all
-- have exactly one sale, so the backfill is the old link copied across.
-- `is distinct from` rather than `is null`: re-running must not rewrite rows
-- that already agree, and must still fix one that somehow does not.
update public.sales s
set catalog_order_id = o.id
from public.catalog_orders o
where o.sale_id = s.id
  and s.catalog_order_id is distinct from o.id;

comment on column public.sales.catalog_order_id is
  'El pedido del catalogo del que nacio esta venta, si nacio de uno. Varias ventas pueden compartir pedido: una por moneda, decision del dueno del 2026-10-25.';

comment on column public.catalog_orders.sale_id is
  'La PRIMERA venta que salio de este pedido. Desde la 158 un pedido puede dar varias, una por moneda, y el enlace completo es sales.catalog_order_id.';

insert into public.schema_migrations (key, description)
values (
  '158_un_pedido_puede_dar_varias_ventas',
  'sales.catalog_order_id: un pedido con dos monedas produce dos ventas, una por moneda. catalog_orders.sale_id pasa a significar la primera.'
)
on conflict (key) do nothing;
