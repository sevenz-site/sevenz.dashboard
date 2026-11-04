import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineaVendida } from "@/lib/reports/ganancia";

// WHAT CAME BACK IN A RANGE, for Reportes. Owner's decision of 2026-11-03: the
// figures fall ON THE DAY OF THE RETURN, not on the day of the sale, so a month
// already looked at does not change afterwards. A day with many returns can
// therefore come out negative, and that was accepted with the choice.
//
// WHICH FIGURE MOVES, given what each card means since 2026-10-29:
//
//   «Devoluciones en X»   the whole value of what came back, and the only card
//                         that says so. It is NOT the sum of the two below: a
//                         return also lands on other fiados or as saldo a favor.
//   Chart «Transacciones» one count per return, the event and not its ledger
//                         lines, the same way a split abono counts once.
//   «Ventas»              does not move: it is what was collected DE CONTADO,
//                         and only fiados can be returned.
//   «Fiados en X»         falls by `to_own`: what stopped being owed on that
//                         fiado. What went to other fiados or a favor was
//                         already paid money, not lending undone.
//   «Abonos en X»         falls by `to_cash`, the only money that left the till.
//                         The rest of a return never entered it.
//   Catálogo              falls by the value, when the sale came from an order.
//   Ganancia, Más         fall per line: a return is a sold line with a negative
//   vendidos, Proveedores quantity, and `cuentasPorProducto` needs no change.
//
// «Inventario» itself needs nothing here: the shelf moved in the database.

export type ReturnOfRange = {
  createdAt: string;
  productId: string | null;
  // As sold. A product renamed or binned since still reads as what came back.
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  // `sale_lines` spelling: 'USD' | 'EUR' | 'COP'.
  currency: string;
  toOwn: number;
  toCash: number;
  fromCatalog: boolean;
};

export async function cargarDevoluciones(
  supabase: SupabaseClient,
  {
    ownerId,
    desdeIso,
    hastaIso,
    clientId = null,
    productId = null,
  }: {
    ownerId: string;
    desdeIso: string;
    hastaIso: string;
    clientId?: string | null;
    productId?: string | null;
  },
): Promise<ReturnOfRange[]> {
  let q = supabase
    .from("sale_returns")
    .select(
      "created_at, product_id, product_name, quantity, unit_price, amount, currency, to_own, to_cash, sales!inner(catalog_order_id)",
    )
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .gte("created_at", desdeIso)
    .lte("created_at", hastaIso);
  if (clientId) q = q.eq("client_id", clientId);
  if (productId) q = q.eq("product_id", productId);

  const { data, error } = await q;
  // SAME LESSON AS THE REST OF REPORTES (2026-10-27): a discarded error draws
  // believable figures.
  if (error) throw new Error(`reportes: devoluciones: ${error.message}`);

  return (data ?? []).map((r) => ({
    createdAt: r.created_at as string,
    productId: (r.product_id as string | null) ?? null,
    productName: r.product_name as string,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    amount: Number(r.amount),
    currency: (r.currency as string | null) ?? "COP",
    toOwn: Number(r.to_own),
    toCash: Number(r.to_cash),
    fromCatalog: Boolean((r.sales as unknown as { catalog_order_id: string | null } | null)?.catalog_order_id),
  }));
}

/**
 * «Más devueltos»: units per product, most first, the name breaking ties so the
 * order is the same on every load. A line with no product behind it cannot be
 * attributed, the same as in «Más vendidos».
 */
export function rankingDeDevueltos(devoluciones: ReturnOfRange[]) {
  const porProducto = new Map<string, { id: string; nombre: string; unidades: number }>();
  for (const d of devoluciones) {
    if (!d.productId) continue;
    const fila = porProducto.get(d.productId);
    if (fila) fila.unidades += d.quantity;
    else porProducto.set(d.productId, { id: d.productId, nombre: d.productName, unidades: d.quantity });
  }
  return [...porProducto.values()].sort(
    (a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, "es"),
  );
}

/** Returns as sold lines with a negative quantity. */
export function lineasDevueltas(devoluciones: ReturnOfRange[]): LineaVendida[] {
  return devoluciones
    .filter((d) => d.productId)
    .map((d) => ({
      productId: d.productId as string,
      currency: d.currency,
      unitPrice: d.unitPrice,
      quantity: -d.quantity,
    }));
}
