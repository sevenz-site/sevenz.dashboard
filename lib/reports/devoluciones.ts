import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineaVendida } from "@/lib/reports/ganancia";

// WHAT CAME BACK IN A RANGE, for Reportes. Owner's decision of 2026-11-03: the
// figures fall ON THE DAY OF THE RETURN, not on the day of the sale, so a month
// already looked at does not change afterwards. A day with many returns can
// therefore come out negative, and that was accepted with the choice.
//
// WHICH FIGURE MOVES, given what each card means since 2026-10-29:
//
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
      "created_at, product_id, quantity, unit_price, amount, currency, to_own, to_cash, sales!inner(catalog_order_id)",
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
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    amount: Number(r.amount),
    currency: (r.currency as string | null) ?? "COP",
    toOwn: Number(r.to_own),
    toCash: Number(r.to_cash),
    fromCatalog: Boolean((r.sales as unknown as { catalog_order_id: string | null } | null)?.catalog_order_id),
  }));
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
