import { notFound, redirect } from "next/navigation";
import {
  OrderRegisterConfirm,
  type LineaDelPedidoParaResumen,
} from "@/components/dashboard/order-register-confirm";
import { createClient } from "@/lib/supabase/server";
import type { PriceCurrency } from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  readOrderProducts,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// THE LAST SCREEN OF THE FLOW: what is about to be written, and the button
// that writes it.
//
// The sealed half of every line comes from the server; what the shopkeeper
// decided along the way lives in the browser's draft, which is why the screen
// itself is a client component. See `OrderRegisterConfirm`.
export default async function ResumenDelRegistroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  if (error) console.error("[orders] resumen del registro:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  if (pedido.registered_at != null || pedido.sale_id != null) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const { data: itemRows, error: errorItems } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", pedido.id)
    .order("product_name", { ascending: true });
  if (errorItems) console.error("[orders] resumen items:", errorItems.message);
  const items = (itemRows ?? []) as CatalogOrderItemRow[];

  // WHICH LINES STILL HAVE A PRODUCT. The screen says so BEFORE the button:
  // the sale cannot carry a line whose product is gone, and finding that out
  // from a message after pressing «Registrar y finalizar» is too late to go
  // back and fix it.
  const productosPorId = await readOrderProducts(supabase, user!.id, items);

  const lineas: LineaDelPedidoParaResumen[] = items.map((i) => ({
    id: i.id,
    nombre: i.product_name,
    cantidad: Number(i.quantity),
    precioUnitario: Number(i.unit_price),
    moneda: i.currency as PriceCurrency,
    tieneProducto: i.product_id != null && productosPorId.has(i.product_id),
  }));

  return <OrderRegisterConfirm pedidoId={pedido.id} lineas={lineas} />;
}
