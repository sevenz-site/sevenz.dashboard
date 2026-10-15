import { unstable_cache } from "next/cache";
import { fetchUsdtP2p } from "@/lib/exchange-rate/usdt-p2p";
import { createServiceClient } from "@/lib/supabase/service";
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

/** Una moneda que el producto maneja. Ver la migración 087. */
export type ProductCurrencyRow = {
  product_id: string;
  currency: PriceCurrency;
};

/**
 * Las monedas activas de un producto, en el orden en que se leen.
 *
 * El orden lo fija `VE_PRICE_CURRENCIES` y no el de la base: una lista cuyo
 * orden depende de en qué orden se insertaron las filas cambia de aspecto
 * entre dos cargas de la misma pantalla.
 */
export function currenciesOf(
  rows: ProductCurrencyRow[],
  productId: string,
  fallback: PriceCurrency,
): PriceCurrency[] {
  const mias = new Set(rows.filter((r) => r.product_id === productId).map((r) => r.currency));
  const orden: PriceCurrency[] = ["USD", "EUR", "USDT", "COP"];
  const out = orden.filter((c) => mias.has(c));
  return out.length > 0 ? out : [fallback];
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
  "id, name, unit, base_currency, price_retail, price_wholesale, cost, " +
  "cost_currency, cost_currency_other, " +
  "margin_retail_pct, margin_wholesale_pct, stock_opening, stock_opening_at, " +
  "wholesale_min_quantity, supplier, " +
  "published_retail, published_wholesale, photo_path, description";

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
// THE PRICE IS ALSO WRITTEN DOWN, so SQL can read it. Migration 112.
//
// WHY THIS IS NOT A CRON: on Vercel's Hobby plan every cron job is limited to
// a DAILY interval -- a `*/30 * * * *` fails at deploy time with "Hobby
// accounts are limited to daily cron jobs" -- and a 24-hour-old P2P price is a
// wrong number about money, unlike the BCV rate, which the central bank itself
// only publishes once a day.
//
// So the refresh rides on the page view. It sits INSIDE the cached function on
// purpose: that body runs exactly on a cache miss, so the write happens about
// once a minute no matter how many people are looking. Putting it outside
// would add a database round trip to every single render for nothing.
//
// IT CANNOT BREAK A PAGE. `set_usdt_p2p_rate` ignores a null or non-positive
// amount, `createServiceClient()` throws when the key is missing, and every
// bit of it is swallowed here: a rate refresh failing must never take down a
// catalogue that renders perfectly well without the USDT row.
async function guardarTasaUsdt(amount: number | null): Promise<void> {
  if (amount == null || amount <= 0) return;
  try {
    const supabase = createServiceClient();
    // AN RPC AND NOT A TABLE WRITE, which is what lets the table keep RLS on
    // with zero policies and zero grants. It is also what `qa:service-role`
    // asks for: reach data behind a SECURITY DEFINER function instead of
    // touching the table with the service key.
    const { error } = await supabase.rpc("set_usdt_p2p_rate", {
      p_amount: amount,
      p_source: "binancep2p",
    });
    if (error) console.error("[guardarTasaUsdt] rpc:", error.message);
  } catch (error) {
    console.error("[guardarTasaUsdt]:", error instanceof Error ? error.message : error);
  }
}

const cachedUsdtPrice = unstable_cache(
  async (officialUsd: number) => {
    const p2p = await fetchUsdtP2p(officialUsd);
    await guardarTasaUsdt(p2p?.ask ?? null);
    return p2p;
  },
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
  // ───────────────────────────────────────────────────────────────────────
  // CUANDO CRIPTOYA NO RESPONDE, LA FILA DE USDT SE QUEDA EN «—».
  //
  // Owner's decision, 2026-10-10, after seeing it happen on screen: the rate
  // keeps coming from CriptoYa, and a failure keeps showing the dash. He asked
  // for this to be written down so we can decide what to do about it later —
  // it is CT-63.
  //
  // What was rejected, and why it matters: falling back to 1 USDT = 1 USD. It
  // is the obvious patch and it is the dangerous one, because the number would
  // change meaning without saying so — 43,8 one day and 50 the next with
  // nothing touched, and no way for a shopkeeper to tell which is the real
  // one. A dash is honest; a wrong number is not.
  //
  // What the dash costs today: the shopkeeper filling in a product sees an
  // empty row and cannot tell whether USDT is unsupported, still loading, or
  // broken. That is the part worth improving, and the cheapest improvement is
  // words rather than a number.
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
