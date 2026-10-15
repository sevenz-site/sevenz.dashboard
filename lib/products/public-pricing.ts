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
 * Las monedas que el cliente puede elegir para pagar.
 *
 * ESTO LEÍA LA TABLA EQUIVOCADA HASTA EL 2026-10-15. Devolvía la base más las
 * fijadas a mano (`bloque.pinned`), que son los precios DESVINCULADOS — no las
 * monedas que el tendero activó. Un producto con dólar, euro y USDT activos y
 * ningún precio fijado ofrecía una sola moneda. Medido en dev con «Casco».
 *
 * La lista de verdad es `product_currencies` (migración 087) y llega desde el
 * servidor en `currencies`. Migración 111 la expone en las tres funciones de
 * lectura del catálogo.
 *
 * ES DEL PRODUCTO, NO DEL ESCALÓN, y eso corrige lo que se decidió el
 * 2026-10-14. `product_currencies` tiene clave `(product_id, currency)` y no
 * tiene columna `tier`, así que el caso que planteó el dueño —«al detal en
 * dólares pero al mayor en euros, USDT y dólares»— el modelo de datos no lo
 * sabe expresar. Lo que cambia entre escalones es solo el importe. Queda
 * escrito porque la decisión del 14 sí hablaba de escalones, y quien la
 * busque tiene que encontrar por qué dejó de aplicarse.
 *
 * SE FILTRA POR LAS QUE TIENEN NÚMERO, y el caso real es el USDT: su tasa
 * viene de CriptoYa y las páginas públicas no la piden (decisión del
 * 2026-10-10), así que en el catálogo llega siempre en null y no se puede
 * calcular. Un producto con USDT activo y sin precio fijado se ofrece en las
 * demás monedas y no en esa. La alternativa —ofrecerla sin importe— deja al
 * cliente elegir algo que `create_catalog_order` rechaza con `sin_tasa`
 * después de que haya rellenado el formulario entero.
 *
 * `base` va primera a propósito — es el precio que el tendero puso, y las
 * demás salieron de él. El orden lo fija el servidor.
 */
export function monedasDelProducto(
  currencies: PriceCurrency[],
  bloque: BloquePrecio | null,
  base: PriceCurrency,
  rates: BolivarRates | null,
): PriceCurrency[] {
  if (bloque == null) return [];

  // LAS FIJADAS A MANO ENTRAN AUNQUE NO ESTÉN EN `currencies`, y esto no es un
  // cinturón: sin ello este arreglo ROMPERÍA productos que hoy funcionan.
  //
  // La migración 087 solo traspasó `base_currency` a `product_currencies`
  // (`select id, base_currency from products`), así que un producto que no se
  // haya vuelto a guardar desde el 2026-10-10 tiene UNA sola moneda activa
  // aunque lleve precios fijados en otras. Antes del 2026-10-15 esas fijadas
  // eran precisamente las únicas que se ofrecían, así que leer solo
  // `currencies` las habría dejado fuera — cambiando un fallo por otro.
  //
  // Y un precio fijado para un escalón es la afirmación más fuerte que existe
  // de que el producto se vende en esa moneda: lo escribió el tendero a mano.
  // `create_catalog_order` acepta exactamente el mismo conjunto, y las dos
  // listas tienen que coincidir o se ofrece algo que el servidor rechaza.
  const fijadas = Object.keys(bloque.pinned) as PriceCurrency[];
  const lista = [base, ...currencies, ...fijadas].filter(
    (c, i, todas) => todas.indexOf(c) === i,
  );
  return lista.filter((c) => precioEnMoneda(bloque, base, c, rates) != null);
}
