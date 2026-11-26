import { parseTypedAmount, type CostCurrency, type PriceCurrency } from "@/lib/products/price";

// Moved here from `components/dashboard/producto-flujo.tsx` on 2026-11-26, unchanged, so the
// catalogue editor and the quick sheet of a sale (which can now re-save a catalogue product)
// store the same margin. Its comment travels with it.

// A pinned currency is one whose price was typed by hand (the field holds a value, even an
// empty one being retyped); see the longer comment where it is used in the editor.
export function estaDesvinculada(
  fijos: Partial<Record<PriceCurrency, string>>,
  currency: PriceCurrency,
): boolean {
  return fijos[currency] !== undefined;
}

// ── WHICH PRICE THE MARGIN IS READ FROM, IN ONE PLACE ──────────────────────
//
// Owner's rule of 2026-11-16: «solo el margen de lo tecleado, si una moneda queda sin
// escribirse el precio de venta, no tiene por qué reportarse margen». So the margin comes
// from a TYPED price only: the base, or a pinned currency. A currency following the rate
// never gives one.
//
// Order: the COST's currency when its price was typed (owner's rule of 2026-11-16, «si ese
// dueño compró ese producto en 5 dolares y lo vende en 7 dólares y 6.5 euros, el margen seguirá
// calculándose en la moneda del costo»), then the currency typed last in this visit, then the
// base, then any pinned currency with a figure (a product whose base price is empty but whose
// euro was typed). Whichever price is picked, `marginFromPrice` measures it in the cost's
// currency. With the cost in bolívares and two typed prices in other currencies, the last
// typed one decides. Three readers use
// it, and they must agree or the review contradicts the step it re-reads: the margin of step
// 2/4, the review of 4/4, and `margin_retail_pct` / `margin_wholesale_pct`, which Reportes
// shows in «Margen por producto».
//
// Accepted edge: reopening a product starts from the base again, so re-saving it for another
// reason stores the base's margin even if the euro was the last one typed months ago.
export function precioDelMargen(
  ultima: PriceCurrency | null,
  currencies: PriceCurrency[],
  fijos: Partial<Record<PriceCurrency, string>>,
  precioBase: number | null,
  monedaDelCosto: CostCurrency,
): { moneda: PriceCurrency; precio: number } | null {
  const base = currencies[0];
  const tecleado = (c: PriceCurrency): number | null => {
    if (c === base) return precioBase;
    if (!estaDesvinculada(fijos, c)) return null;
    const n = parseTypedAmount(fijos[c] ?? "");
    return n != null && n > 0 ? n : null;
  };
  const delCosto = currencies.find((c) => c === monedaDelCosto);
  const orden = [
    ...(delCosto != null ? [delCosto] : []),
    ...(ultima != null && currencies.includes(ultima) ? [ultima] : []),
    base,
    ...currencies.filter((c) => c !== base),
  ];
  for (const moneda of orden) {
    const precio = tecleado(moneda);
    if (precio != null) return { moneda, precio };
  }
  return null;
}
