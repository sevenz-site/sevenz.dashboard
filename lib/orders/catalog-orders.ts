import type { SupabaseClient } from "@supabase/supabase-js";

// CATALOGUE ORDERS, READ SIDE. Deliverable D of the inventory plan.
//
// ===========================================================================
// WHY "UNATTENDED" AND "UNREAD" ARE NOT THE SAME THING
//
// The owner decided on 2026-10-16 that the bell's red number counts orders
// that still need attention, not notifications nobody has opened (CT-71).
// Those are two different states and conflating them is how a counter starts
// lying: the shopkeeper opens the bell, the number drops to zero, and three
// orders are still sitting there unprepared.
//
// So an order's notice does NOT carry a `read_at` of its own. It derives its
// state from the order: `status = 'new'` is unattended and therefore still
// counted, anything else is attended and drops out. One number, and it stays
// honest because it is reading the thing it claims to be about.
//
// The columns this needs -- `status` and `seen_at` -- have been on the table
// since migration 108, put there on purpose for this.
// ===========================================================================

export type CatalogOrderStatus = "new" | "seen" | "registered" | "discarded";

export type CatalogOrderRow = {
  id: string;
  owner_id: string;
  catalog_link_id: string | null;
  customer_name: string;
  customer_document: string;
  // La letra, desde la migración `155`. `null` en todo pedido anterior: a
  // nadie se le preguntó, y no hay nada que deducir.
  customer_document_type: string | null;
  customer_whatsapp: string;
  customer_whatsapp_raw: string;
  wants_whatsapp_notices: boolean;
  status: CatalogOrderStatus;
  seen_at: string | null;
  created_at: string;
  // La dirección, desde la migración `157`: la pide el carrito y es `null` en
  // todo pedido anterior.
  customer_address: string | null;
  // SI ESTE PEDIDO YA ES UNA VENTA — migración `157`. Las dos columnas, y no
  // una: `sale_id` dice CUÁL es y `registered_at` CUÁNDO se hizo, que es lo
  // que la pantalla del pedido enseña.
  //
  // Se seleccionan SIEMPRE y no solo donde hacen falta. Son la única parada
  // que impide registrar dos veces el mismo pedido, y una parada que depende
  // de que cada lector se acuerde de pedir la columna no es una parada: la
  // pantalla que la olvide sigue compilando y deja al cliente debiendo el
  // doble, sin error y sin nada en rojo.
  sale_id: string | null;
  registered_at: string | null;
};

export type CatalogOrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  currency: string;
  tier: "retail" | "wholesale";
  comment: string | null;
};

export const ORDER_COLUMNS =
  "id, owner_id, catalog_link_id, customer_name, customer_document, customer_document_type, customer_whatsapp, customer_whatsapp_raw, wants_whatsapp_notices, status, seen_at, created_at, customer_address, sale_id, registered_at";

export const ORDER_ITEM_COLUMNS =
  "id, order_id, product_id, product_name, quantity, unit_price, currency, tier, comment";

// UN PEDIDO ESTÁ PENDIENTE MIENTRAS NO ESTÉ REGISTRADO.
//
// Decisión del dueño el 2026-10-25: *«eliminemos el concepto de pedido
// atendido, el pedido se recibe (…) y en el app el pedido se registra (…) si
// presiona el botón "Registrar pedido" y no completa el registro, el pedido
// vuelve a su estado original»*.
//
// SE PREGUNTA POR «registered» Y NO POR «new», y esa es toda la diferencia.
// Antes había un escalón intermedio —`seen`, que ponía «Marcar como
// atendido»— y un pedido en él dejaba de contar como pendiente sin que nadie
// hubiera registrado nada. Ese botón y ese sello ya no existen, pero las
// filas viejas que quedaron en `seen` sí: preguntando por el final, vuelven a
// contar como pendientes, que es lo que son.
//
// `discarded` NO CUENTA, aunque tampoco esté registrado: es el estado de un
// pedido descartado a propósito. Hoy no lo escribe nadie; está en el `check`
// de la migración `108` y esto es lo que impide que el día que se escriba
// empiece a sonar en la campana.
export function isUnregistered(order: Pick<CatalogOrderRow, "status">): boolean {
  return order.status !== "registered" && order.status !== "discarded";
}

// The number the bell and the Catálogo link both show: orders NOT registered. A `head: true` count
// so it never drags the rows across just to say how many there are.
export async function countUnregisteredOrders(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .not("status", "in", "(registered,discarded)");

  // A failure counts as zero rather than throwing: this number decorates a
  // link and a bell, and neither is worth taking a screen down for. The real
  // reason goes to the server log.
  if (error) {
    console.error("[orders] count sin registrar:", error.message);
    return 0;
  }
  return count ?? 0;
}

// WHAT AN ORDER IS WORTH, PER CURRENCY, and never as one total.
//
// Same rule the cart already follows (owner decision, 2026-10-14, decision 4):
// there is no EUR→USD rate anywhere in this product, only BCV to bolívares,
// so adding two currencies into a single figure would be inventing one. A
// shopkeeper reading "total: 45" would have no way to know what 45 means.
export function totalsByCurrency(
  items: Pick<CatalogOrderItemRow, "quantity" | "unit_price" | "currency">[],
): { currency: string; amount: number }[] {
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    const line = Number(item.quantity) * Number(item.unit_price);
    byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? 0) + line);
  }
  return [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

// ===========================================================================
// THE PRODUCT BEHIND AN ORDER LINE — frame 1371:7229, 2026-10-17
//
// The owner asked to open a line of an order and see the product in detail.
// His decision of the same day, after the frame contradicted an earlier one:
// THE PRODUCT BLOCK IS TODAY'S CATALOGUE, THE ORDER CARD IS SEALED.
//
// That is not a compromise, it is what the screen is for. Cost, supplier,
// margin and stock are the shopkeeper's own numbers and he is reading them to
// decide whether to fulfil the order -- a stock of "12" from last Tuesday
// helps nobody, and a frozen cost or margin would be actively misleading. The
// one thing the customer actually agreed to --how many, at what price, at
// which tier-- is already sealed in `catalog_order_items` and needs no
// migration to stay that way.
//
// WHAT IT COSTS, said out loud: change a product's photo or description and
// an old order's card shows the new one. The screen says that block is the
// catalogue, which is the honest mitigation, not a cure.
//
// `product_id` IS NULLABLE AND A DELETED PRODUCT IS A REAL STATE. The line
// keeps its name and price either way, so the row still reads; the detail
// then has nothing to show and says so rather than opening half empty.
export type OrderProductRow = {
  id: string;
  name: string;
  unit: string | null;
  description: string | null;
  photo_path: string | null;
  stock_opening: number | null;
  cost: number | null;
  cost_currency: string | null;
  cost_currency_other: string | null;
  supplier: string | null;
  margin_retail_pct: number | null;
  margin_wholesale_pct: number | null;
  price_retail: number | null;
  price_wholesale: number | null;
  base_currency_retail: string | null;
  base_currency_wholesale: string | null;
};

export const ORDER_PRODUCT_COLUMNS =
  "id, name, unit, description, photo_path, stock_opening, cost, cost_currency, cost_currency_other, supplier, margin_retail_pct, margin_wholesale_pct, price_retail, price_wholesale, base_currency_retail, base_currency_wholesale";

// The products an order's lines point at, indexed by id.
//
// ONE QUERY FOR THE WHOLE ORDER, not one per line opened. The detail is a
// dialog that is already mounted: fetching on open would put a wait exactly
// where the shopkeeper expects an immediate answer, and an order has a
// handful of lines.
//
// `.eq("owner_id", ownerId)` EXPLICITLY, even though the ids come from an
// order already proven to be his: it is one filter, and it is the rule this
// project wrote after `getOrCreateShareLink` and `confirmImport`.
export async function readOrderProducts(
  supabase: SupabaseClient,
  ownerId: string,
  items: Pick<CatalogOrderItemRow, "product_id">[],
): Promise<Map<string, OrderProductRow>> {
  const ids = [...new Set(items.map((i) => i.product_id).filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("products")
    .select(ORDER_PRODUCT_COLUMNS)
    .eq("owner_id", ownerId)
    .in("id", ids);

  // A failed read is not "the product was deleted": the dialog would say the
  // product is gone when it is right there. Logged and left empty, which the
  // dialog reports as "no pudimos cargarlo".
  if (error) {
    console.error("[orders] readOrderProducts:", error.message);
    return new Map();
  }

  return new Map((data ?? []).map((p) => [p.id, p as OrderProductRow]));
}
