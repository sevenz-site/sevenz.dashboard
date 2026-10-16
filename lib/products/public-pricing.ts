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

  // THE CURRENCY `price` IS WRITTEN IN, and it belongs to the TIER, not to the
  // product. Migration 114, owner's decision of 2026-10-15: wholesale can be
  // offered in euros while retail is still typed in dollars.
  //
  // IT LIVES INSIDE THE BLOCK ON PURPOSE, and that shape IS the safety. While
  // the base was a separate argument, every call site had both tiers' prices
  // and one product-level base within reach, so converting a wholesale price
  // with the retail base was a plausible typo that nothing would catch: USD
  // 6.01 quoted as EUR 6.01 is about 8% dearer and entirely believable. With
  // the base in the block there is no second base to reach for.
  base: PriceCurrency;

  // What THIS tier is offered in. Three at retail and one at wholesale is the
  // case the owner asked for, and before 114 the model could not express it:
  // `product_currencies` had no `tier`, so the two tiers shared one list and
  // removing a currency from one removed it from the other.
  currencies: PriceCurrency[];
};

export type ProductoPublico = {
  retail: BloquePrecio | null;
  wholesale: BloquePrecio | null;
  wholesale_min_quantity: number | null;
};

/**
 * What `get_shared_product`, `get_shared_products` and `get_shared_catalog`
 * put in a tier's block, before it is a `BloquePrecio`.
 *
 * TWO NAMES FOR ONE THING, and the translation lives here rather than in each
 * page. The payload says `base_currency`, matching the column; the type says
 * `base`, because inside a block there is only one. Three pages each doing
 * this inline is three places for the fallback below to be forgotten in.
 */
export type BloqueCrudo = {
  price: number;
  pinned: Partial<Record<PriceCurrency, number>>;
  base_currency?: PriceCurrency | null;
  currencies?: PriceCurrency[] | null;
};

/**
 * Turns one raw tier block into a `BloquePrecio`.
 *
 * THE FALLBACKS ARE FOR ONE WINDOW ONLY: code deployed before migration 114
 * has run. CLAUDE.md puts migrations first precisely so this cannot happen,
 * and this is the belt for the day somebody inverts the order.
 *
 * They degrade rather than break, which is the whole point of choosing them
 * carefully. Without a tier base it falls back to the PRODUCT's, which is
 * exactly what every tier used before 114 -- so prices stay correct, they just
 * stop being per-tier. Without a currency list it falls back to empty, and
 * `monedasDelBloque` still adds the base and the pinned ones, so the customer
 * is offered what they were offered before 114 instead of nothing at all.
 *
 * What neither fallback can do is invent a WRONG number: both land on the
 * pre-114 behaviour, never on a price converted with the other tier's base.
 */
export function bloqueDesdeRpc(
  bruto: BloqueCrudo | null | undefined,
  baseDelProducto: PriceCurrency,
): BloquePrecio | null {
  if (bruto == null) return null;
  return {
    price: bruto.price,
    pinned: bruto.pinned ?? {},
    base: bruto.base_currency ?? baseDelProducto,
    currencies: bruto.currencies ?? [],
  };
}

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
  currency: PriceCurrency,
  rates: BolivarRates | null,
): number | null {
  if (bloque == null) return null;

  const fijado = bloque.pinned[currency];
  if (fijado != null && fijado > 0) return fijado;
  if (currency === bloque.base) return bloque.price;
  if (rates == null) return null;

  return priceIn(
    currency,
    { amount: bloque.price, currency: bloque.base },
    rates,
    bloque.pinned,
  ).amount;
}

/**
 * The currencies the customer can choose to pay in, for ONE tier.
 *
 * THIS READ THE WRONG TABLE UNTIL 2026-10-15. It returned the base plus the
 * hand-pinned ones (`bloque.pinned`), which are the UNLINKED prices -- not the
 * currencies the shopkeeper enabled. A product with dollar, euro and USDT
 * enabled and no pinned price offered a single currency. Measured in dev with
 * «Casco».
 *
 * AND IT WAS PER PRODUCT UNTIL MIGRATION 114, which is the second half of the
 * same story. `product_currencies` had no `tier`, so both tiers shared one
 * list: the owner reported on 2026-10-15 that removing a currency from one
 * removed it from the other, and that it should be possible to have «los tres
 * precios al detal pero solo uno al mayor». Migration 111's header had
 * recorded that case as inexpressible and said a `tier` column would be needed
 * first; 114 is that column.
 *
 * SO IT TAKES A BLOCK AND NOTHING ELSE. The tier's base and the tier's list
 * both live inside it, which is what makes "convert this tier with the other
 * tier's base" unwriteable rather than merely discouraged.
 *
 * PINNED PRICES COUNT EVEN WHEN THEY ARE NOT IN `currencies`, and this is not
 * a belt-and-braces: without it this would BREAK products that work today.
 * Migration 087 only carried `base_currency` over to `product_currencies`, so
 * a product not re-saved since 2026-10-10 holds one enabled currency even when
 * it carries pinned prices in others -- and before 2026-10-15 those pinned
 * ones were precisely the only ones on offer. A price pinned for a tier is the
 * strongest possible statement that the tier sells in that currency: the
 * shopkeeper typed it by hand. `create_catalog_order` accepts exactly the same
 * set, and the two have to match or the screen offers what the server rejects.
 *
 * FILTERED DOWN TO THE ONES THAT HAVE A NUMBER, and the real case is USDT: its
 * rate comes from CriptoYa, and when it is missing or stale the currency is
 * simply not offered rather than offered without an amount -- which would let
 * the customer pick something rejected with `sin_tasa` after filling in the
 * whole form.
 *
 * The base comes first: it is the price the shopkeeper set, and the rest
 * derive from it.
 */
export function monedasDelBloque(
  bloque: BloquePrecio | null,
  rates: BolivarRates | null,
): PriceCurrency[] {
  if (bloque == null) return [];

  const fijadas = Object.keys(bloque.pinned) as PriceCurrency[];
  const lista = [bloque.base, ...bloque.currencies, ...fijadas].filter(
    (c, i, todas) => todas.indexOf(c) === i,
  );
  return lista.filter((c) => precioEnMoneda(bloque, c, rates) != null);
}

