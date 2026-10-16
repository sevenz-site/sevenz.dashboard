import { createClient } from "@/lib/supabase/server";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { OrdersList, type OrderWithItems } from "@/components/dashboard/orders-list";
import { readOwnerCountry } from "@/lib/owner-country";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// THE CATALOGUE'S ORDERS. Deliverable D, reading half.
//
// ===========================================================================
// WHY THE DATA EXISTED BEFORE THIS SCREEN DID
//
// The cart has been storing orders since 2026-10-15 and the catalogue reached
// production on 2026-10-16. Between those two dates orders were written to
// `catalog_orders` and **no screen read them**: the shopkeeper only found out
// through the WhatsApp message the customer sends from their own phone.
//
// That works nearly always and fails in one specific way. The owner's
// decision 1 of 2026-10-14 stores the order BEFORE opening WhatsApp precisely
// because *«si el cliente nunca llega a pulsar enviar, que en iOS pasa, el
// pedido existe igual»*. Without this screen, that order exists and nobody can
// read it.
// ===========================================================================

export default async function OrdenesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: orders, error: errorOrders }, country] = await Promise.all([
    supabase
      .from("catalog_orders")
      .select(ORDER_COLUMNS)
      .eq("owner_id", user!.id)
      // UNATTENDED FIRST, most recent at the top within each group.
      // Ordering by date alone would bury yesterday's unprepared order under
      // three of today's already dealt with -- the exact opposite of what the
      // shopkeeper needs to see when the screen opens.
      .order("status", { ascending: true })
      .order("created_at", { ascending: false }),
    readOwnerCountry(supabase, user!.id),
  ]);

  // A FAILED READ IS NOT AN EMPTY SHOP, and until 2026-10-16 this screen said
  // it was. Migration 108 created these tables with RLS on and no grant for
  // `authenticated`, so every read came back `42501: permission denied` --
  // and because the error was discarded, the shopkeeper was shown "todavía no
  // te ha llegado ningún pedido" while three orders sat in the database with
  // their customers' names and phone numbers. Migration 116 fixed the grant;
  // this branch is what makes the next failure of any kind say so out loud
  // instead of impersonating good news.
  if (errorOrders) console.error("[orders] list:", errorOrders.message);

  const rows = (orders ?? []) as CatalogOrderRow[];

  // THE LINES, IN ONE ROUND TRIP. A query per order would be N+1 on a screen
  // the shopkeeper opens several times a day.
  let items: CatalogOrderItemRow[] = [];
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("catalog_order_items")
      .select(ORDER_ITEM_COLUMNS)
      .in(
        "order_id",
        rows.map((o) => o.id),
      );
    if (error) console.error("[orders] list items:", error.message);
    items = (data ?? []) as CatalogOrderItemRow[];
  }

  const porPedido = new Map<string, CatalogOrderItemRow[]>();
  for (const item of items) {
    const lista = porPedido.get(item.order_id);
    if (lista) lista.push(item);
    else porPedido.set(item.order_id, [item]);
  }

  const conLineas: OrderWithItems[] = rows.map((o) => ({
    ...o,
    items: porPedido.get(o.id) ?? [],
  }));

  const sinAtender = rows.filter((o) => o.status === "new").length;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Pedidos"
        subtitle={
          sinAtender > 0
            ? `${sinAtender} sin atender`
            : "Lo que te piden desde tu enlace de catálogo"
        }
        // This screen has no search or filters yet, and `ScreenHeader`
        // requires both. They go in as an explicit `null` rather than being
        // made optional: the header reserves their space, so the day filters
        // arrive they drop in without shifting anything else.
        search={null}
        filters={null}
      />
      <h2 className="mt-1 text-xl font-semibold">Pedidos recibidos</h2>
      {errorOrders ? (
        // The real reason is in the server log and stays there. What the
        // shopkeeper needs is to know that the screen could not answer, so
        // they do not read silence as "nobody ordered".
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No pudimos cargar tus pedidos ahora mismo. Vuelve a intentarlo en un momento.
        </p>
      ) : (
        <OrdersList
          orders={conLineas}
          // The owner's zone, never the server's: this page renders on
          // Vercel, which runs in UTC.
          timeZone={country === "VE" ? "America/Caracas" : "America/Bogota"}
        />
      )}
    </div>
  );
}
