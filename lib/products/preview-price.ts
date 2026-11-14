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

// ===========================================================================
// THE SAME LINE FROM THE OWNER'S OWN ROWS — 2026-11-09
//
// The owner asked that day that the text sent with a product link carry «Nombre
// + precio (puede tener precio en USD y/o EUR)». The preview already computes
// that price, so the message uses THIS function too: the chat bubble and the
// card under it cannot then disagree.
//
// The owner's screens do not call `get_shared_product`; they hold the product
// row, its pinned prices and its enabled currencies. This rebuilds the blocks
// that RPC returns from them, by the same rules: only a PUBLISHED tier with a
// price counts (the link is for customers), `pinned` is that tier's overrides,
// and the currencies are the tier's base plus the enabled ones, which is
// `product_catalog_currencies` (migration 114). `qa:precio-compartido` compares
// the two faces product by product, because this is a second writer of a rule
// SQL already owns.
export type OwnerProductForPreview = {
  base_currency: PriceCurrency;
  base_currency_retail: PriceCurrency;
  base_currency_wholesale: PriceCurrency;
  price_retail: number | null;
  price_wholesale: number | null;
  published_retail: boolean;
  published_wholesale: boolean;
  wholesale_min_quantity: number | null;
};

type Tier = "retail" | "wholesale";

export function ownerPreviewPriceInput(
  product: OwnerProductForPreview,
  pinned: Record<Tier, Partial<Record<PriceCurrency, number>>>,
  currencies: Record<Tier, PriceCurrency[]>,
  rates: { usd: number; eur: number } | null,
): PreviewPriceInput {
  const block = (tier: Tier): BloqueCrudo | null => {
    const published = tier === "retail" ? product.published_retail : product.published_wholesale;
    const price = tier === "retail" ? product.price_retail : product.price_wholesale;
    if (!published || price == null) return null;
    return {
      price: Number(price),
      pinned: Object.fromEntries(
        Object.entries(pinned[tier] ?? {}).map(([c, v]) => [c, Number(v)]),
      ) as Partial<Record<PriceCurrency, number>>,
      base_currency: tier === "retail" ? product.base_currency_retail : product.base_currency_wholesale,
      currencies: currencies[tier] ?? [],
    };
  };
  return {
    retail: block("retail"),
    wholesale: block("wholesale"),
    wholesale_min_quantity:
      product.wholesale_min_quantity == null ? null : Number(product.wholesale_min_quantity),
    base_currency: product.base_currency,
    rates: rates ? { usd: rates.usd, eur: rates.eur } : null,
  };
}

// THE MESSAGE ITSELF: the product, its price, and the link on its own line so
// WhatsApp draws the preview under it. Without a price (nothing published, or
// no rate to quote it) it is the name and the link.
export function productShareMessage(name: string, priceLine: string | null, url: string): string {
  return priceLine ? `${name} · ${priceLine}\n${url}` : `${name}\n${url}`;
}

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

  const rates = p.rates ? { usd: p.rates.usd, eur: p.rates.eur } : null;
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
