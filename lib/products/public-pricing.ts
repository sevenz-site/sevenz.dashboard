import type { PriceCurrency } from "@/lib/products/price";

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
 * Las monedas que el cliente puede elegir para pagar, en el escalón que le
 * toca: la base del producto más las que el tendero fijó a mano para ESE
 * escalón.
 *
 * `base` va primera a propósito — es el precio que el tendero puso, y las
 * demás salieron de él.
 */
export function monedasDelEscalon(
  bloque: BloquePrecio | null,
  base: PriceCurrency,
): PriceCurrency[] {
  if (bloque == null) return [];
  const fijadas = Object.keys(bloque.pinned) as PriceCurrency[];
  return [base, ...fijadas.filter((c) => c !== base)];
}
