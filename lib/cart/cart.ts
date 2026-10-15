import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import {
  escalonParaCantidad,
  precioEnMoneda,
  type BloquePrecio,
  type ProductoPublico,
} from "@/lib/products/public-pricing";

// EL CARRITO DEL CLIENTE FINAL. Entregable C del frame 1192:4185.
//
// ===========================================================================
// UNA LINEA GUARDA LO MINIMO, Y ESO ES LA DECISION IMPORTANTE
//
// Una linea es `{ productId, quantity, currency, comment }`. NO guarda el
// precio, ni el nombre, ni la foto. Todo eso se pide al servidor cada vez que
// se pinta el carrito.
//
// La alternativa —congelar el precio al anadir— se descarto por dos razones,
// y la segunda es la que decide:
//
//   1. El tendero puede cambiar el precio mientras el cliente mira. Un
//      carrito con el precio de hace diez minutos ensena una cifra y la orden
//      guarda otra, porque **el servidor recalcula al crearla** (candado 5 de
//      la migracion 109). Dos numeros distintos sobre lo mismo, y el cliente
//      se entera cuando ya pidio.
//
//   2. EL ESCALON DEPENDE DE LA CANTIDAD TOTAL. Si el cliente anade 3 y luego
//      3 mas, son 6: con el minimo al mayor en 6, el precio de esa linea
//      CAMBIA al fusionarse. Un precio congelado al anadir seria el de detal
//      para una cantidad que ya es de mayor.
//
// Asi que el carrito guarda la intencion y el precio lo pone quien sabe: el
// servidor para la orden, y `get_shared_products` para pintarlo.
//
// ===========================================================================
// LO QUE SE GUARDA EN EL NAVEGADOR, Y POR QUE AQUI SI VALE
//
// Esto vive en `localStorage`, y `CLAUDE.md` dice que nada que importe puede
// depender de que el navegador coopere —iOS Safari borra el almacenamiento
// tras un tiempo inactivo—. No es una excepcion a esa regla: es que el
// carrito ANTES de enviarse no importa. Si se borra, el cliente vuelve a
// anadir dos productos. Lo que importa es la ORDEN, y esa la guarda el
// servidor. La linea esta justo ahi.

export type LineaCarrito = {
  productId: string;
  quantity: number;
  currency: PriceCurrency;
  comment: string | null;
};

// Lo que el servidor devuelve para pintar el carrito: la misma forma que
// `get_shared_product`, porque es la misma informacion.
export type ProductoDelCarrito = ProductoPublico & {
  id: string;
  name: string;
  photo_path: string | null;
  // THE PRODUCT'S DEFAULT CURRENCY, and since migration 114 it prices
  // nothing. Each tier carries its own base and its own currency list inside
  // its `BloquePrecio`. Kept because the cart shows the product as a whole
  // before any tier applies.
  base_currency: PriceCurrency;
  stock: number | null;
};

/**
 * Anade una linea, fusionando con la que ya hubiera del mismo producto.
 *
 * SE SUMAN LAS CANTIDADES — decision del dueno el 2026-10-15. Y con ellas
 * puede cambiar el escalon, que es justo la razon por la que una linea no
 * guarda precio: ver la cabecera.
 *
 * LA MONEDA NUEVA GANA, porque es la que el cliente acaba de elegir mirando
 * la pantalla. Y el comentario NO se pierde nunca: si los dos tienen texto y
 * son distintos, se juntan. Perder un comentario al anadir dos veces seria
 * irrecuperable — el carrito no deja editarlos.
 */
export function agregarLinea(lineas: LineaCarrito[], nueva: LineaCarrito): LineaCarrito[] {
  const i = lineas.findIndex((l) => l.productId === nueva.productId);
  if (i === -1) return [...lineas, nueva];

  const vieja = lineas[i];
  const comentario = juntarComentarios(vieja.comment, nueva.comment);
  const fusionada: LineaCarrito = {
    productId: vieja.productId,
    quantity: vieja.quantity + nueva.quantity,
    currency: nueva.currency,
    comment: comentario,
  };
  return lineas.map((l, j) => (j === i ? fusionada : l));
}

// 500 es el tope de la columna (migracion 108). Cortar aqui evita que el
// servidor rechace la orden entera por un comentario largo, que seria el peor
// sitio para enterarse.
const MAX_COMENTARIO = 500;

function juntarComentarios(a: string | null, b: string | null): string | null {
  const uno = (a ?? "").trim();
  const dos = (b ?? "").trim();
  if (uno === "") return dos === "" ? null : dos.slice(0, MAX_COMENTARIO);
  if (dos === "" || uno === dos) return uno.slice(0, MAX_COMENTARIO);
  return `${uno} · ${dos}`.slice(0, MAX_COMENTARIO);
}

export function cambiarCantidad(
  lineas: LineaCarrito[],
  productId: string,
  quantity: number,
): LineaCarrito[] {
  // Llegar a cero es quitar. Es lo que espera quien pulsa «−» hasta el final,
  // y lo contrario —una linea de cero— es un estado que la pantalla tendria
  // que saber pintar y el servidor rechazaria.
  if (quantity <= 0) return lineas.filter((l) => l.productId !== productId);
  return lineas.map((l) => (l.productId === productId ? { ...l, quantity } : l));
}

export function quitarLinea(lineas: LineaCarrito[], productId: string): LineaCarrito[] {
  return lineas.filter((l) => l.productId !== productId);
}

export function cuantosArticulos(lineas: LineaCarrito[]): number {
  return lineas.reduce((n, l) => n + l.quantity, 0);
}

/**
 * El precio unitario de una linea HOY, con el escalon que le toca por su
 * cantidad y en la moneda elegida.
 *
 * Devuelve `null` cuando la moneda elegida ya no existe en ese escalon — pasa
 * de verdad: el cliente elige euros con 6 unidades (precio de mayor, que los
 * tiene fijados) y luego baja a 3, que es precio de detal y solo tiene
 * dolares. La pantalla lo trata cayendo a la moneda base, no reventando.
 */
export function precioUnitario(
  producto: ProductoDelCarrito,
  linea: LineaCarrito,
  rates: BolivarRates | null,
): { amount: number; currency: PriceCurrency; tier: "retail" | "wholesale" } | null {
  const tier = escalonParaCantidad(producto, linea.quantity);
  if (tier == null) return null;

  const bloque: BloquePrecio | null = tier === "wholesale" ? producto.wholesale : producto.retail;
  if (bloque == null) return null;

  // THE CURRENCY HAS TO STILL BE ON OFFER. Until 2026-10-15 this function only
  // resolved the base and the pinned prices, so a line in a currency the
  // shopkeeper derived from the rate -- the common case, not the exception --
  // returned null and the product VANISHED from the cart with no message at
  // all. That was the same wrong assumption as in `monedasDelProducto`, in the
  // one place where it was invisible: the screen renders a cart that is simply
  // missing a product the customer remembers adding.
  //
  // The check stays, pointed at the right list: a currency that has been
  // withdrawn since the line was saved still has to resolve to null, because
  // the server would reject it.
  //
  // THE SET IS EXACTLY THE ONE `create_catalog_order` ACCEPTS -- the TIER's
  // base, the tier's enabled list, or a price pinned for that tier -- and that
  // is not a detail. A pinned currency missing from `product_currencies` is
  // the normal state of any product not re-saved since migration 087, which
  // only carried `base_currency` over. Were this list narrower than the
  // server's, the cart would hide a line the order would have taken; wider, it
  // would quote one the order rejects whole.
  //
  // EVERYTHING COMES OUT OF `bloque` SINCE MIGRATION 114. It used to read
  // `producto.base_currency`, which was right only while both tiers shared one
  // base: now a cart line at the wholesale tier has to be judged against the
  // WHOLESALE base, and reading the product-level one would quote a euro price
  // as if it were dollars.
  if (
    linea.currency !== bloque.base &&
    !bloque.currencies.includes(linea.currency) &&
    bloque.pinned[linea.currency] == null
  ) {
    return null;
  }

  const amount = precioEnMoneda(bloque, linea.currency, rates);
  if (amount == null) return null;
  return { amount, currency: linea.currency, tier };
}

/**
 * SUBTOTALES POR MONEDA, NO UN TOTAL UNICO.
 *
 * Decision del dueno el 2026-10-14, y es lo unico exacto: no hay tasa de
 * EUR a USD en ninguna parte del producto, solo del BCV a bolivares. Un
 * «total» con monedas mezcladas obligaria a inventarse una conversion, y lo
 * que el cliente va a pagar no es una conversion inventada.
 *
 * El orden lo fija el de aparicion en el carrito, no el alfabetico: asi la
 * lista de subtotales se lee en el mismo orden en que se armo el pedido.
 */
/**
 * EL RESUMEN AGRUPADO POR MONEDA, para la pantalla de «pedido registrado»
 * (frame `1326:5835`).
 *
 * Es lo mismo que `subtotales` pero conservando las líneas, y existe aparte
 * porque esa pantalla se pinta DESPUÉS de vaciar el carrito: necesita una
 * foto completa de lo que se pidió, no una suma que dependa de un carrito que
 * ya no está.
 *
 * El orden lo fija el de aparición, no el alfabético: el pedido se lee en el
 * mismo orden en que se armó.
 */
export function resumenPorMoneda(
  lineas: LineaCarrito[],
  productos: Map<string, ProductoDelCarrito>,
  rates: BolivarRates | null,
): {
  currency: PriceCurrency;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  total: number;
}[] {
  const porMoneda = new Map<PriceCurrency, { name: string; quantity: number; unitPrice: number; total: number }[]>();

  for (const l of lineas) {
    const p = productos.get(l.productId);
    if (p == null) continue;
    const precio = precioUnitario(p, l, rates);
    if (precio == null) continue;
    const lista = porMoneda.get(precio.currency) ?? [];
    lista.push({
      name: p.name,
      quantity: l.quantity,
      unitPrice: precio.amount,
      total: precio.amount * l.quantity,
    });
    porMoneda.set(precio.currency, lista);
  }

  return [...porMoneda.entries()].map(([currency, items]) => ({
    currency,
    items,
    total: items.reduce((n, i) => n + i.total, 0),
  }));
}

export function subtotales(
  lineas: LineaCarrito[],
  productos: Map<string, ProductoDelCarrito>,
  rates: BolivarRates | null,
): { currency: PriceCurrency; amount: number }[] {
  const porMoneda = new Map<PriceCurrency, number>();
  for (const l of lineas) {
    const p = productos.get(l.productId);
    if (p == null) continue;
    const precio = precioUnitario(p, l, rates);
    if (precio == null) continue;
    porMoneda.set(precio.currency, (porMoneda.get(precio.currency) ?? 0) + precio.amount * l.quantity);
  }
  return [...porMoneda.entries()].map(([currency, amount]) => ({ currency, amount }));
}
