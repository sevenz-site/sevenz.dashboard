// THE PROMOTION'S PRICE (CT-184, migration 228). One rule for every screen that shows a
// discounted price -- the catalogue grid, the product page, the cart, the owner's «below
// cost» warning -- and the SAME rule as `create_catalog_order_core`, which is the one that
// decides what is stored. If the two disagree by a cent, the customer sees one figure and
// the order keeps another; `qa:promociones` compares them.
//
// The rounding is the price's own: two decimals, four in bolívares (BS_DECIMALS, owner's
// decision of 2026-11-17), ordinary half-up like Postgres `round()` on positive numbers.
//
// NO IMPORTS, on purpose: `qa/promociones.mjs` loads this with Node's type stripping, which
// cannot follow an extensionless import.

export type PromoCurrency = "USD" | "EUR" | "COP" | "VES";

// What the customer's pages receive from `get_shared_promotion` (null when none is on).
export type SharedPromotion = {
  id: string;
  name: string;
  banner_path: string | null;
  ends_on: string;
  last_day: string;
  extended: boolean;
  // Always true since migration 230; read only when `wholesale_percents` is missing (a page
  // served before 230 ran), when the wholesale tier falls back to the retail %.
  includes_wholesale: boolean;
  has_code: boolean;
  // product id -> % for the retail tier.
  percents: Record<string, number>;
  // product id -> % for the wholesale tier (migration 230: a group may carry its own).
  wholesale_percents?: Record<string, number>;
};

function round(amount: number, currency: PromoCurrency): number {
  const f = currency === "VES" ? 10_000 : 100;
  return Math.round(amount * f + Number.EPSILON * f) / f;
}

// The price after `percent`, or the same price when there is none.
export function applyPromotion(price: number, percent: number | null | undefined, currency: PromoCurrency): number {
  if (percent == null || !(percent > 0)) return price;
  return round((price * (100 - percent)) / 100, currency);
}

// The % a product gets in a tier, read from the shared promotion.
export function promotionPercentFor(
  promo: SharedPromotion | null | undefined,
  productId: string,
  tier: "retail" | "wholesale",
): number | null {
  if (!promo) return null;
  let pct: number | undefined;
  if (tier === "wholesale") {
    if (promo.wholesale_percents) pct = promo.wholesale_percents[productId];
    else if (promo.includes_wholesale) pct = promo.percents[productId];
  } else {
    pct = promo.percents[productId];
  }
  return typeof pct === "number" && pct > 0 ? pct : null;
}

// The last day the CUSTOMER is told about. Before the close it is the close itself, not the
// extension: the extension is the owner's «prórroga», announced as «¡Extendida!» only once the
// close has passed (frames 10 and 11). Using `last_day` here told customers «Termina el 2 dic»
// on 28 nov for a promotion closing on the 30th -- found in the browser QA of 2026-11-28.
// `min` because an «end now» can cut the promotion before its close.
export function customerEndDay(promo: SharedPromotion): string {
  if (promo.extended) return promo.last_day;
  return promo.ends_on < promo.last_day ? promo.ends_on : promo.last_day;
}

// The largest % in the promotion, for «hasta 40% menos».
export function maxPercent(promo: SharedPromotion): number {
  return Math.max(0, ...Object.values(promo.percents), ...Object.values(promo.wholesale_percents ?? {}));
}
