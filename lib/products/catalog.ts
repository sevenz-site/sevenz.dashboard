import { unstable_cache } from "next/cache";
import { fetchUsdtP2p } from "@/lib/exchange-rate/usdt-p2p";
import type { BolivarRates, PriceCurrency, PriceTier } from "@/lib/products/price";

// WHAT THE CATALOGUE SCREEN NEEDS, ASSEMBLED ON THE SERVER.
//
// Kept out of the page so that the movement form can reuse it later without
// dragging a page's worth of imports behind it.

export type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  base_currency: PriceCurrency;
  price_retail: number | null;
  price_wholesale: number | null;
  cost: number | null;
  margin_pct: number | null;
};

export type PriceOverrideRow = {
  product_id: string;
  tier: PriceTier;
  currency: PriceCurrency;
  amount: number;
};

// THE USDT PRICE IS ASKED FOR ONCE A MINUTE, NOT ONCE PER RENDER.
//
// `/api/usdt` already caches in module memory for the browser, but a Server
// Component does not go through that route: it would call CriptoYa on every
// page load, and a catalogue gets refreshed every time a product is saved.
//
// `unstable_cache` gives the same 60 seconds on the server side. The number
// matches the route's on purpose — two different windows for the same price
// would show one figure in the calculator and another in the catalogue, which
// is exactly the kind of difference nobody can explain afterwards.
const cachedUsdtPrice = unstable_cache(
  async (officialUsd: number) => fetchUsdtP2p(officialUsd),
  ["usdt-p2p-catalog"],
  { revalidate: 60 },
);

/**
 * Bolívares per unit of each currency, for the catalogue's equivalences.
 *
 * `usdt` uses `ask` — the BUYING price. Owner's decision, 2026-10-09: it is
 * what the customer has to pay to get that USDT, and if it is going to be
 * wrong it should be wrong in the shopkeeper's favour, since the money is
 * theirs.
 *
 * Returns `usdt: null` when CriptoYa is down or returned an out-of-band price
 * that the library discards on purpose. That is not an error state: the screen
 * shows the rest and says that one is missing.
 */
export async function getBolivarRates(effectiveRate: {
  usd: number;
  eur: number;
}): Promise<BolivarRates> {
  let usdt: number | null = null;
  try {
    const p2p = await cachedUsdtPrice(effectiveRate.usd);
    usdt = p2p?.ask ?? null;
  } catch (error) {
    // `fetchUsdtP2p` does not throw by contract, but the cache wrapper can.
    // A missing equivalence must never take the catalogue down with it.
    console.error("[getBolivarRates] usdt:", error instanceof Error ? error.message : error);
  }
  return { usd: effectiveRate.usd, eur: effectiveRate.eur, usdt };
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
