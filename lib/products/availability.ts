// ═══════════════════════════════════════════════════════════════════════
// HOW MUCH IS LEFT: THE ONE PLACE THAT DECIDES IT
//
// Asked for by the owner on 2026-10-29, with a screenshot of a product whose
// chip read a green «Disponible: 0»: *«cuando un producto tiene disponible =<
// que el número del aviso seteado (…) el card debe ser el card amarillo (…)
// aplica también para el catálogo, pedidos, reportes, vista del cliente»*.
//
// ───────────────────────────────────────────────────────────────────────
// WHY THE RULE LIVES HERE AND NOT IN THE BADGE
//
// Eight screens draw this chip and each one had the comparison written by
// hand. The badge is the easy half; the hard half is agreeing on what "low"
// means, and that answer has to be identical on the shopkeeper's product page
// and on the catalogue his customer opens — or the same product is scarce on
// one screen and plentiful on the other, to two people looking at it together.
//
// This repo has paid for that exact split twice already: `lib/share-balance.ts`
// and `lib/ventas-de-contado.ts` both exist because a rule written twice
// drifted.
//
// ───────────────────────────────────────────────────────────────────────
// FOUR STATES, AND THE TWO EDGES THAT ARE EASY TO GET WRONG
//
//   · `uncounted` — the quantity is NULL. That is "I don't track this one",
//     not "none left". Migration 107 made the same distinction for the
//     customer's catalogue and it matters here for a stupid reason: in
//     JavaScript `null <= 5` is TRUE, because null coerces to 0. Comparing
//     without this guard paints every untracked product amber.
//
//   · `out` — zero. It stays its own state and KEEPS ITS RED. The owner chose
//     this on 2026-10-29 over the literal reading of his own rule (0 <= 5, so
//     amber): «repón pronto» and «se acabó» are two different instructions to
//     a shopkeeper, and one colour for both is one instruction fewer.
//
//     It also keeps a decision of his from 2026-10-15 intact. The customer's
//     catalogue card says «No disponible» at zero; if zero had turned amber
//     with a figure, the card and the product page would have contradicted
//     each other again — which is the contradiction that decision fixed.
//
//   · `low` — between 1 and the threshold, inclusive.
//
//   · `in_stock` — anything above it.
//
// ───────────────────────────────────────────────────────────────────────
// A THRESHOLD OF ZERO NEVER PAINTS ANYTHING AMBER
//
// Zero means «no me avises» — see `guardarUmbralDeStock`, where that is
// spelled out. Without the `threshold > 0` guard, an out-of-stock product
// would alert precisely the shopkeeper who asked not to be alerted. That is
// not a rounding error in a condition: it is the setting doing the opposite of
// what it says.
// ═══════════════════════════════════════════════════════════════════════

/** What migration `163` gives a brand-new owner. Mirrored, not read, on purpose: a default in code that disagrees with the column is a bug that only shows up for accounts created before it changed. Only use it when the real value could not be loaded. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export type StockState = "uncounted" | "out" | "low" | "in_stock";

export function stockState(quantity: number | null, threshold: number): StockState {
  if (quantity == null) return "uncounted";
  if (quantity <= 0) return "out";
  // `threshold > 0` FIRST: see the note above. Zero is "don't alert me".
  if (threshold > 0 && quantity <= threshold) return "low";
  return "in_stock";
}
