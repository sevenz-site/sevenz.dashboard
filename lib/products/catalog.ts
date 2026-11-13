import type { BolivarRates, PriceCurrency, PriceTier } from "@/lib/products/price";

// WHAT THE CATALOGUE SCREEN NEEDS, ASSEMBLED ON THE SERVER.
//
// Kept out of the page so that the movement form can reuse it later without
// dragging a page's worth of imports behind it.

export type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  // THE PRODUCT'S DEFAULT, and since migration 114 it prices nothing: each
  // tier has its own below. Kept because the grid and the filters group by it.
  base_currency: PriceCurrency;
  // The currency each tier's price is WRITTEN IN. They can differ -- owner's
  // decision of 2026-10-15 -- so anything converting one tier's amount has to
  // reach for that tier's own and never for `base_currency`.
  base_currency_retail: PriceCurrency;
  base_currency_wholesale: PriceCurrency;
  price_retail: number | null;
  price_wholesale: number | null;
  cost: number | null;
  // DESDE LA 087 EL COSTO LLEVA SU MONEDA. Antes estaba implícitamente en
  // `base_currency`, y eso dejó de valer en cuanto un producto puede venderse
  // solo en euros con el costo apuntado en dólares.
  cost_currency: string | null;
  cost_currency_other: string | null;
  // One margin per tier since 084. The single `margin_pct` of 083 could not
  // represent what Tendero 2 described in the field: 10, 15 or 30 per cent
  // depending on whether he is selling wholesale or retail.
  margin_retail_pct: number | null;
  margin_wholesale_pct: number | null;
  // THE QUANTITY THAT NOTHING MOVES YET. Owner's decision, 2026-10-09: the
  // field ships now and the event machine later, so selling or lending does
  // not decrement it. `_opening` is in the name so that nothing reads it as
  // "the stock right now" — see the migration's own note.
  stock_opening: number | null;
  // Donde compro el tendero este producto. Texto libre, migracion 103.
  //
  // Se lee para dos cosas: rellenar el campo al editar, y alimentar las
  // sugerencias del autocompletado. Lo segundo es la razon de que la pantalla
  // NO necesite ninguna consulta nueva -- /productos ya carga todos los
  // productos del dueno, asi que la lista de proveedores sale de aqui.
  supplier: string | null;
  // Migration 184: one category per product, or none.
  category_id: string | null;
  // La cantidad desde la que aplica el precio de mayor. Migracion 088.
  wholesale_min_quantity: number | null;
  stock_opening_at: string | null;
  // PUBLICAR ES POR ESCALON desde la 085. El frame 1187:3728 pone un
  // interruptor y dos casillas: un producto puede estar en el catalogo de
  // mayorista, en el de detal, en los dos, o en ninguno. Con un solo booleano
  // los dos enlaces ensenaban lo mismo a distinto precio.
  published_retail: boolean;
  published_wholesale: boolean;
  photo_path: string | null;
  description: string | null;
};

/**
 * Una moneda que un ESCALÓN del producto maneja. Migración 087, y `tier` desde
 * la 114 -- antes la lista era del producto entero, que es lo que hacía que
 * quitar una moneda al mayor la quitara también al detal.
 */
export type ProductCurrencyRow = {
  product_id: string;
  tier: PriceTier;
  currency: PriceCurrency;
};

/**
 * Las monedas activas de UN escalón, con su base la primera.
 *
 * LA BASE VA PRIMERA Y ESO ES UN CONTRATO, no una preferencia estética:
 * `TierSection` deriva su moneda base con `currencies[0]`, así que el orden de
 * esta lista decide en qué moneda se escribe el precio de ese escalón.
 *
 * Antes de la migración 114 el orden salía entero de la lista fija de abajo, y
 * daba igual: la base era del producto y venía de otro sitio. Con una base por
 * escalón eso se vuelve un fallo — un producto cuyo mayor está en euros y que
 * además ofrece dólares habría puesto el dólar primero, por orden alfabético,
 * y el tendero habría acabado escribiendo su precio en la moneda equivocada.
 *
 * El resto sí va en orden fijo y no en el de inserción: una lista cuyo orden
 * depende de en qué orden se insertaron las filas cambia de aspecto entre dos
 * cargas de la misma pantalla.
 */
export function currenciesOf(
  rows: ProductCurrencyRow[],
  productId: string,
  tier: PriceTier,
  base: PriceCurrency,
): PriceCurrency[] {
  const mias = new Set(
    rows.filter((r) => r.product_id === productId && r.tier === tier).map((r) => r.currency),
  );
  const orden: PriceCurrency[] = ["USD", "EUR", "COP"];
  return [base, ...orden.filter((c) => mias.has(c) && c !== base)];
}

export type PriceOverrideRow = {
  product_id: string;
  tier: PriceTier;
  currency: PriceCurrency;
  amount: number;
};

// The column list is written once here, because three callers need exactly the
// same shape — the catalogue page, and soon the movement form and the product
// selector. A `select("*")` would have worked and would also have shipped
// `cost` to any client component that happened to receive a row.
export const PRODUCT_COLUMNS =
  "id, name, unit, base_currency, base_currency_retail, base_currency_wholesale, " +
  "price_retail, price_wholesale, cost, " +
  "cost_currency, cost_currency_other, " +
  "margin_retail_pct, margin_wholesale_pct, stock_opening, stock_opening_at, " +
  "wholesale_min_quantity, supplier, category_id, " +
  "published_retail, published_wholesale, photo_path, description";

/**
 * Bolívares per unit of each currency, for the catalogue's equivalences.
 *
 * NO USDT SINCE CT-171 (2026-11-12). This used to ask CriptoYa for the Binance P2P
 * price on every catalogue load -- behind a 60-second cache -- and store it for
 * `create_catalog_order`. No product can be priced in USDT any more (migration 203),
 * so the public pages no longer call a third party at all. The calculator's USDT tab
 * still gets its price, through `/api/usdt`.
 *
 * Still async so its fifteen callers did not have to change.
 */
export async function getBolivarRates(effectiveRate: {
  usd: number;
  eur: number;
}): Promise<BolivarRates> {
  return { usd: effectiveRate.usd, eur: effectiveRate.eur };
}

/**
 * The pinned prices of one product, keyed by tier, ready for `priceIn`.
 */
export function overridesByTier(
  rows: PriceOverrideRow[],
  productId: string,
): Record<PriceTier, Partial<Record<PriceCurrency, number>>> {
  const out: Record<PriceTier, Partial<Record<PriceCurrency, number>>> = {
    retail: {},
    wholesale: {},
  };
  for (const r of rows) {
    if (r.product_id !== productId) continue;
    out[r.tier][r.currency] = r.amount;
  }
  return out;
}

/** Si el producto esta en algun catalogo publico. */
export function isPublished(p: ProductRow): boolean {
  return p.published_retail || p.published_wholesale;
}

/**
 * The price the catalogue card shows for a product, and which tier it is.
 *
 * THE LOWEST OF THE TWO. Owner's decision, 2026-10-10, and the same rule the
 * public page now follows (migration 086). It used to be "retail if there is
 * one", which is the HIGHER of the two whenever a product has both.
 *
 * Saying WHICH tier it is matters more than ever now: a figure labelled
 * nothing, next to a figure that happens to be the wholesale one, is how a
 * shopkeeper quotes the wrong price off their own screen.
 *
 * The table requires one of the two prices, so there is always an answer.
 */
export function listPrice(p: ProductRow): { amount: number; tier: PriceTier } {
  if (p.price_retail == null) return { amount: p.price_wholesale!, tier: "wholesale" };
  if (p.price_wholesale == null) return { amount: p.price_retail, tier: "retail" };
  return p.price_wholesale < p.price_retail
    ? { amount: p.price_wholesale, tier: "wholesale" }
    : { amount: p.price_retail, tier: "retail" };
}
