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
  customer_whatsapp: string;
  customer_whatsapp_raw: string;
  wants_whatsapp_notices: boolean;
  status: CatalogOrderStatus;
  seen_at: string | null;
  created_at: string;
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
  "id, owner_id, catalog_link_id, customer_name, customer_document, customer_whatsapp, customer_whatsapp_raw, wants_whatsapp_notices, status, seen_at, created_at";

export const ORDER_ITEM_COLUMNS =
  "id, order_id, product_id, product_name, quantity, unit_price, currency, tier, comment";

// AN ORDER IS UNATTENDED WHILE IT IS `new`. Not "while `seen_at` is null":
// the two move together today, but `status` is the one the rest of the
// product reads and the one the owner's button will set, so there is one
// definition and it is this one.
export function isUnattended(order: Pick<CatalogOrderRow, "status">): boolean {
  return order.status === "new";
}

// The number the bell and the Catálogo link both show. A `head: true` count
// so it never drags the rows across just to say how many there are.
export async function countUnattendedOrders(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "new");

  // A failure counts as zero rather than throwing: this number decorates a
  // link and a bell, and neither is worth taking a screen down for. The real
  // reason goes to the server log.
  if (error) {
    console.error("[orders] count unattended:", error.message);
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
