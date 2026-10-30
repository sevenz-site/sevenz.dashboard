import {
  bloqueDesdeRpc,
  cantidadMinima,
  escalonParaCantidad,
  monedasDelBloque,
  precioEnMoneda,
  type BloqueCrudo,
  type ProductoPublico,
} from "@/lib/products/public-pricing";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

// THE PRICE LINE OF A SHARED PRODUCT'S LINK PREVIEW.
//
// Owner's request of 2026-10-30, from user comments: the preview WhatsApp draws
// for a product link should carry the price. The frame (the "Sharing card")
// draws it as a row under the name -- a flag and an amount per currency, dollar
// and euro -- so that is what this builds.
//
// ===========================================================================
// THIS REVERSES A DECISION, AND THE OLD REASON IS KEPT HERE
//
// `app/c/[token]/[productId]/page.tsx` used to say the preview carried NO price
// on purpose: the name, the photo and "a cómo" in a link preview tell anyone who
// forwards the link what the business sells and at what price, and they should
// be choosing to forward it, not discovering it because the thumbnail already
// said so. On 2026-10-27 the owner added a Share button, which answered the
// "choosing" half; the price stayed out because the frame did not draw one. The
// frame now does, and the owner asked for it.
//
// WHAT IT COSTS, for whoever reconsiders: a forwarded link now shows the price
// without opening it. It is the same price the page shows to anyone who has the
// link, so nothing new is DISCLOSED -- it is shown earlier.
//
// ===========================================================================
// IT SAYS WHAT THE PAGE SAYS, AND THAT IS THE WHOLE DESIGN
//
// A preview that disagrees with the page it links to is worse than none: the
// customer reads `$5,00` in the chat and finds `$6,00` once it opens. So this
// reuses the page's own functions rather than re-deriving anything:
//
//   · THE TIER is `escalonParaCantidad` at `cantidadMinima` -- the one the page
//     opens on. Retail when both exist; wholesale only when that is all there
//     is, and then the line says so, because an unlabelled `$4,00` that only
//     applies from 6 units is the exact misreading the owner's 2026-10-14
//     decision was about.
//   · THE CURRENCIES are `monedasDelBloque`, the ones the owner enabled and the
//     rates can quote. The preview shows dollar, euro and peso out of those, in
//     that order, and falls back to the base when none of them applies (a
//     bolivar- or USDT-based product).
//
// NO USDT RATE IS FETCHED. The page gets it from CriptoYa behind a cache; a
// crawler that reads this once per link should not trigger a third-party call.
// The consequence is deliberate and small: a currency that can only be derived
// through USDT is left out of the preview, and the page still offers it.
//
// A PREVIEW IS A SNAPSHOT. WhatsApp reads the link once and keeps what it read,
// so a price changed afterwards does not change a preview already sent. The page
// always shows the live one.

// The flag goes before each amount, as in the frame. Currencies without a flag
// (USDT) are written bare.
const FLAG: Partial<Record<PriceCurrency, string>> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  COP: "🇨🇴",
  VES: "🇻🇪",
};

// What a preview shows, in the order it reads. Bolivar and USDT are left out:
// four amounts do not fit the one line a preview gives the price.
const SHOWN: PriceCurrency[] = ["USD", "EUR", "COP"];

export type PreviewPriceInput = {
  retail: BloqueCrudo | null;
  wholesale: BloqueCrudo | null;
  wholesale_min_quantity: number | null;
  base_currency: PriceCurrency;
  // The shop's bolivars-per-unit rates, or null outside Venezuela / without one.
  rates: { usd: number; eur: number } | null;
};

/** The price line, or null when the product carries no price to show. */
export function previewPriceLine(p: PreviewPriceInput): string | null {
  const product: ProductoPublico = {
    retail: bloqueDesdeRpc(p.retail, p.base_currency),
    wholesale: bloqueDesdeRpc(p.wholesale, p.base_currency),
    wholesale_min_quantity: p.wholesale_min_quantity,
  };

  const tier = escalonParaCantidad(product, cantidadMinima(product));
  if (tier == null) return null;
  const block = product[tier];
  if (block == null || !(block.price > 0)) return null;

  const rates = p.rates ? { usd: p.rates.usd, eur: p.rates.eur, usdt: null } : null;
  const offered = monedasDelBloque(block, rates);

  let currencies = SHOWN.filter((c) => offered.includes(c));
  // The base is always quotable, and is the honest fallback.
  if (currencies.length === 0) currencies = [block.base];

  const parts = currencies.flatMap((currency) => {
    const amount = precioEnMoneda(block, currency, rates);
    if (amount == null) return [];
    const flag = FLAG[currency];
    const text = formatPriceAmount(amount, currency);
    return [flag ? `${flag} ${text}` : text];
  });
  if (parts.length === 0) return null;

  const line = parts.join("  ");
  if (tier === "retail") return line;

  // Wholesale is the only way this product is sold.
  const min = product.wholesale_min_quantity;
  return min != null && min > 1 ? `${line} al mayor (desde ${min})` : `${line} al mayor`;
}
