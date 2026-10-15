import { priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// QUÉ PRECIO VE EL CLIENTE FINAL, SEGÚN CUÁNTO PIDE.
//
// Decisión del dueño el 2026-10-14, y CORRIGE EL FRAME `1192:4185`. El frame
// dibuja los dos bloques de precio juntos —«Precio al detal» y «Precio al
// mayor»— y el dueño lo descartó con su propio caso:
//
//   «si el tendero coloca un precio al detal de 5 dólares pero al mayor coloca
//   euros, USDT y dólares y venta al mayor a partir de 6 unidades, entonces se
//   mostrarán las monedas de los precios al mayor a partir de la selección
//   mayor o igual que 6, si es menor se mostraría solo la moneda de pago en
//   dólares. Se ve uno o el otro, no los dos.»
//
// ESTO VIVE AQUÍ Y NO EN LA PANTALLA por una razón concreta: es la única parte
// del detalle público que puede equivocarse **sin que nadie se entere**. Si se
// rompe, un cliente ve el precio de mayor por una unidad —o paga de más por
// doce— y lo que hace es cerrar la página. No hay reporte, no hay error en
// ningún log, y el tendero solo nota que no le compran. Como función pura la
// vigila `qa:precio-publico`.

export type EscalonPublico = "retail" | "wholesale";

export type BloquePrecio = {
  price: number;
  // Only the prices the shopkeeper UNLINKED and typed by hand. An absent
  // currency is not an unsold one -- it is one whose price is still derived
  // from the rate. Reading this map as "the currencies on offer" is the bug
  // migration 111 fixes; the list of currencies lives in `product_currencies`
  // and arrives separately.
  pinned: Partial<Record<PriceCurrency, number>>;
};

export type ProductoPublico = {
  retail: BloquePrecio | null;
  wholesale: BloquePrecio | null;
  wholesale_min_quantity: number | null;
};

/**
 * La cantidad más pequeña que el cliente puede pedir.
 *
 * Normalmente 1. La excepción es el producto que SOLO se vende al mayor: ahí
 * no hay otro precio al que caer, así que pedir menos del mínimo no significa
 * nada y el dueño pidió que no se deje —con un aviso en rojo si lo teclea—.
 *
 * Es la ÚNICA barrera dura de toda la pantalla, y se aparta de lo que el mismo
 * dueño decidió para el stock, donde se deja pedir de más y solo se avisa. La
 * diferencia tiene sentido: el stock es un número que hoy nadie mantiene
 * (`CT-59`), y el mínimo del mayor es una condición de venta que el tendero
 * escribió a propósito.
 */
export function cantidadMinima(p: ProductoPublico): number {
  const soloMayor = p.retail == null && p.wholesale != null;
  if (!soloMayor) return 1;
  return Math.max(1, p.wholesale_min_quantity ?? 1);
}

/**
 * Qué escalón se enseña para esta cantidad. Nunca los dos.
 *
 * SIN CANTIDAD MÍNIMA NO SE LLEGA AL MAYOR, y es el lado seguro: sin umbral no
 * hay forma de alcanzarlo, así que se queda en el de detal. Un precio
 * mayorista cobrado por una unidad es dinero perdido, y el tendero lo arregla
 * poniendo el mínimo —que desde el 2026-10-14 nace en 6—.
 *
 * Se midió antes de decidirlo: **3 de los 6 productos de dev con precio de
 * mayor no tienen mínimo**, así que el caso no es teórico.
 *
 * OJO, LA BASE DICE LO CONTRARIO: la migración 088 documenta que un mínimo
 * nulo significa «sin mínimo», o sea que el precio de mayor aplicaría siempre.
 * Esa lectura se descarta aquí a propósito, y queda escrito porque el `check`
 * de la 088 sigue permitiendo el null y quien lo lea puede suponer lo otro.
 */
export function escalonParaCantidad(p: ProductoPublico, cantidad: number): EscalonPublico | null {
  if (p.retail == null && p.wholesale == null) return null;
  // Solo se vende de una forma: no hay nada que decidir.
  if (p.retail == null) return "wholesale";
  if (p.wholesale == null) return "retail";

  const umbral = p.wholesale_min_quantity;
  if (umbral == null) return "retail";
  return cantidad >= umbral ? "wholesale" : "retail";
}

/**
 * What one unit costs in a given currency, or null when that cannot be
 * answered.
 *
 * SAME ORDER AS `priceIn`, AND THE ORDER IS NOT THE INTUITIVE ONE: a pinned
 * price wins even over the base, because a closed padlock is an explicit
 * decision by the shopkeeper while the base is only the starting value.
 *
 * NO 1:1 FALLBACK WHEN THERE IS NO RATE, and that is the whole reason this
 * function exists instead of calling `priceIn` at each site. The screen used
 * to pass `rates ?? { usd: 1, eur: 1, usdt: null }`, which was harmless only
 * because a derived currency was never on offer: the base and the pinned
 * paths never read the rate at all. From the moment conversion became the
 * main path, that fallback would quote EUR at parity with USD -- EUR 45.50
 * for a USD 45.50 product -- to any Venezuelan shop whose BCV rate happened
 * to be missing, and it would look like a real price. Found while building
 * migration 111, never shipped.
 *
 * `null` means "no number", and every caller has to treat it as "do not
 * offer this". A currency the customer cannot be quoted is one the order
 * function rejects, so offering it only moves the failure to after the form.
 */
export function precioEnMoneda(
  bloque: BloquePrecio | null,
  base: PriceCurrency,
  currency: PriceCurrency,
  rates: BolivarRates | null,
): number | null {
  if (bloque == null) return null;

  const fijado = bloque.pinned[currency];
  if (fijado != null && fijado > 0) return fijado;
  if (currency === base) return bloque.price;
  if (rates == null) return null;

  return priceIn(currency, { amount: bloque.price, currency: base }, rates, bloque.pinned).amount;
}

/**
 * The currencies the customer can choose to pay in.
 *
 * THIS READ THE WRONG TABLE UNTIL 2026-10-15. It returned the base plus the
 * hand-pinned ones (`bloque.pinned`), which are the UNLINKED prices -- not the
 * currencies the shopkeeper enabled. A product with dollar, euro and USDT
 * enabled and no pinned price offered a single currency. Measured in dev with
 * «Casco».
 *
 * The real list is `product_currencies` (migration 087) and it arrives from
 * the server in `currencies`. Migration 111 exposes it in all three catalogue
 * read functions.
 *
 * IT BELONGS TO THE PRODUCT, NOT TO THE TIER, and that corrects what was
 * decided on 2026-10-14. `product_currencies` is keyed `(product_id,
 * currency)` and has no `tier` column, so the case the owner described --
 * «al detal en dólares pero al mayor en euros, USDT y dólares» -- the data
 * model cannot express at all. What changes between tiers is only the amount.
 * Written down because the decision of the 14th did talk about tiers, and
 * whoever goes looking for it has to find why it stopped applying.
 *
 * FILTERED DOWN TO THE ONES THAT HAVE A NUMBER, and the real case is USDT: its
 * rate comes from CriptoYa and public pages do not ask for it (decision of
 * 2026-10-10), so in the catalogue it always arrives null and cannot be
 * computed. A product with USDT enabled and no pinned price is offered in the
 * other currencies and not in that one. The alternative -- offering it with no
 * amount -- lets the customer pick something `create_catalog_order` rejects
 * with `sin_tasa` after they have filled in the entire form.
 *
 * `base` comes first on purpose -- it is the price the shopkeeper set, and the
 * rest derive from it. The server fixes the ordering.
 */
export function monedasDelProducto(
  currencies: PriceCurrency[],
  bloque: BloquePrecio | null,
  base: PriceCurrency,
  rates: BolivarRates | null,
): PriceCurrency[] {
  if (bloque == null) return [];

  // PINNED PRICES COUNT EVEN WHEN THEY ARE NOT IN `currencies`, and this is
  // not a belt-and-braces: without it this fix would BREAK products that work
  // today.
  //
  // Migration 087 only carried `base_currency` over to `product_currencies`
  // (`select id, base_currency from products`), so a product not re-saved
  // since 2026-10-10 holds ONE enabled currency even when it carries pinned
  // prices in others. Before 2026-10-15 those pinned ones were precisely the
  // only ones on offer, so reading `currencies` alone would have dropped them
  // -- trading one bug for another.
  //
  // And a price pinned for a tier is the strongest possible statement that the
  // product sells in that currency: the shopkeeper typed it by hand.
  // `create_catalog_order` accepts exactly the same set, and the two lists
  // have to match or the screen offers something the server rejects.
  const fijadas = Object.keys(bloque.pinned) as PriceCurrency[];
  const lista = [base, ...currencies, ...fijadas].filter(
    (c, i, todas) => todas.indexOf(c) === i,
  );
  return lista.filter((c) => precioEnMoneda(bloque, base, c, rates) != null);
}
