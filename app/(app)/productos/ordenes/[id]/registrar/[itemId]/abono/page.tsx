import { notFound, redirect } from "next/navigation";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import {
  OrderLineSealedCard,
  totalDeHoy,
} from "@/components/dashboard/order-line-sealed-card";
import { OrderLinePaymentForm } from "@/components/dashboard/order-line-payment-form";
import { createClient } from "@/lib/supabase/server";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  readOrderProducts,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// STEP 2/2 OF REGISTERING ONE LINE OF A CATALOGUE ORDER — frame `1564:11028`
// («Nuevo registro producto», title «Registrar abono», subtitle «2/2 Abono»).
//
// Reached from step 1/2's «Continuar»; the sitemap's arrow says so. The
// payment fields themselves are `OrderLinePaymentForm`, which mounts the sale
// wizard's own `PagoCampos` — see that file for why this is not a copy.
//
// EVERY GUARD OF STEP 1/2 IS REPEATED HERE and that is not redundancy: this
// URL can be typed, bookmarked, or reached by the back button long after 1/2
// decided anything. A guard that only runs on the previous screen is not a
// guard.
export default async function AbonoDeLineaPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `.eq("owner_id", user.id)` EXPLICITLY — both ids come from the URL.
  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  if (error) console.error("[orders] abono de linea:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  // THE HARD STOP. An order that is already a sale cannot be walked again:
  // the second pass would write the charge twice and the customer would owe
  // double, with nothing on screen saying so.
  if (pedido.registered_at != null || pedido.sale_id != null) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const { data: itemRow, error: errorItem } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("id", itemId)
    .eq("order_id", pedido.id)
    .maybeSingle();

  if (errorItem) console.error("[orders] abono de linea item:", errorItem.message);
  if (!itemRow) notFound();
  const linea = itemRow as CatalogOrderItemRow;

  const [productosPorId, rateContext] = await Promise.all([
    readOrderProducts(supabase, user!.id, [linea]),
    getOwnerRateContext(supabase, user!.id),
  ]);
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  const producto = linea.product_id ? (productosPorId.get(linea.product_id) ?? null) : null;
  const cantidad = Number(linea.quantity);
  const precioUnitario = Number(linea.unit_price);
  const moneda = linea.currency as PriceCurrency;
  const total = Math.round(cantidad * precioUnitario * 100) / 100;
  const { total: totalHoy, moneda: monedaHoy } = totalDeHoy(producto, linea.tier, cantidad);

  return (
    <div className="flex flex-col gap-4">
      {/* BACK TO 1/2 AND NOT TO THE ORDER. It is the step the shopkeeper came
          from, and going back one step is what a «1/2 · 2/2» counter promises.

          `soloEnTelefono={false}` because `app-header.tsx` hides the app bar
          across the whole of `/productos` at every width. */}
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}/registrar/${linea.id}`}
        label="Volver al producto"
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Registrar abono</ScreenTitle>
        <p className="text-sm text-muted-foreground">2/2 Abono</p>
        {/* FULL, because this IS the last step of the pair. The owner
            reported the opposite case on 2026-10-23 — a bar at 100 % in the
            middle of a flow, which the next screen then contradicts. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* THE SAME CARD AS 1/2, which is what the frame draws: the shopkeeper
          is about to type an amount and this is the ceiling. Without it the
          figure is written blind and the limit arrives as a rejection. */}
      <OrderLineSealedCard
        nombre={linea.product_name}
        cantidad={cantidad}
        precioUnitario={precioUnitario}
        moneda={moneda}
        totalHoy={totalHoy}
        monedaHoy={monedaHoy}
        rates={rates}
      />

      <OrderLinePaymentForm
        pedidoId={pedido.id}
        lineaId={linea.id}
        moneda={moneda}
        ownerId={user!.id}
        total={total}
        rates={rates}
        prevista={rateContext?.prevista ?? null}
      />
    </div>
  );
}
