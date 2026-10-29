import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import { formatBsAmount } from "@/lib/exchange-rate/format";

// ═══════════════════════════════════════════════════════════════════════
// LA GANANCIA DE UN PRODUCTO, EN UN SOLO SITIO
//
// Decisión del dueño el 2026-10-28, preguntado con las tres lecturas
// delante: la línea «$ 000.000.000 de ganancia» de las hojas de Inventario
// es **lo que ese producto le dejó en el periodo** --(precio − costo) × lo
// vendido--, no la ganancia que duerme en la estantería ni la de una unidad.
//
// Vive aquí y no dentro de `inventario.ts` porque la pestaña «Proveedores»
// hace la MISMA cuenta para sacar su margen. Dos copias de una resta de
// dinero es justo lo que `CLAUDE.md` prohíbe desde que `editar-linea.ts` se
// sacó de su pantalla por la misma razón.
//
// ───────────────────────────────────────────────────────────────────────
// EL COSTO Y LA VENTA CASI NUNCA ESTÁN EN LA MISMA MONEDA
//
// Y eso no es un borde: **medido en dev el 2026-10-28, 24 de las 47 líneas
// vendidas atribuibles con costo escrito tenían la moneda de venta distinta
// de la del costo**. Más de la mitad. Saltárselas habría partido la cifra por
// dos en silencio, que es el fallo que no avisa.
//
// ASÍ QUE EL COSTO SE CONVIERTE, con `priceIn` y las tasas del día. No es una
// licencia que me tome aquí: es exactamente lo que `priceFromCost` ya hace en
// la ficha del producto para sugerir el precio en euros de un costo en
// dólares, y lo que la app entera usa para pasar de una moneda a otra.
//
// LO QUE NO SE HACE NUNCA es inventar el número cuando no se puede. Tres
// casos devuelven `null`, y `null` se dibuja como «—» y se explica:
//
//   1. El producto no tiene costo escrito (la mitad del catálogo de dev).
//   2. Su costo está en una moneda «Otra», texto libre del que no sabemos
//      ninguna tasa.
//   3. No hay tasas --negocio colombiano, o el BCV sin responder-- y las dos
//      monedas no coinciden. `priceIn` ya devuelve `null` para COP contra
//      cualquier otra, porque no existe una tasa Bs/COP y no se finge.
//
// Es la misma política escrita en `priceFromCost`: *«Un null se ensena como
// "—" y se explica; lo que no se hace nunca es inventar un numero»*.
//
// ───────────────────────────────────────────────────────────────────────
// LA TASA ES LA DE HOY, Y ESO TIENE UN COSTE QUE SE DICE
//
// Una venta en euros de hace tres semanas se compara contra un costo en
// dólares convertido con la tasa de HOY, no con la de aquel día. La línea no
// guarda la tasa (`sale_lines` no tiene `rate_used`; quien sí la guarda es
// `sale_payments`, para el recibo).
//
// Se acepta porque esta cifra es un INDICADOR de reporte, no un recibo: nadie
// la cobra ni se la enseña a un cliente. La regla «SIEMPRE MANDA EL MONTO QUE
// TECLEÓ EL TENDERO» protege lo segundo --lo que se escribió se guarda y se
// repite--, y aquí no se está repitiendo nada tecleado: se está calculando
// una diferencia que nunca existió como cifra escrita.
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
// LAS DOS FÓRMULAS DE ESTE ARCHIVO, PARA AUDITARLAS DE UN VISTAZO
//
//   Ganancia de un producto (la línea «$X de ganancia»)
//     Por cada línea vendida suya en el rango:
//       ingreso  = unit_price × quantity
//       costo    = costoEnMonedaDeVenta(producto, moneda de la línea) × quantity
//       ganancia = ingreso − costo
//     Se acumula POR MONEDA DE VENTA y se enseña en la que más ingresos tuvo.
//     Una línea cuyo costo no se puede expresar en su moneda suma a los
//     ingresos y NO a la ganancia, y se cuenta en `lineasSinCosto`.
//
//   Margen de un grupo (la fila de un proveedor)
//     margen % = (Σ ganancia ÷ Σ costo) × 100     ← SOBRE EL COSTO
//     Solo entran las líneas cuya ganancia se pudo calcular, numerador y
//     denominador a la vez. Con varias monedas los dos lados se llevan a
//     bolívares: un PORCENTAJE sí puede cruzar monedas aunque una suma de
//     dinero no.
//
//   Cuándo es `null`, y nunca cero
//     1. El producto no tiene costo escrito.
//     2. Su costo está en una moneda «Otra», texto libre sin tasa.
//     3. No hay tasas y las dos monedas no coinciden (Colombia, o el BCV
//        caído). `priceIn` ya devuelve `null` para COP contra cualquier otra.
//
//   La tasa es la de HOY
//     `sale_lines` no guarda la suya. Una venta en euros de hace tres semanas
//     se compara contra un costo en dólares convertido con la tasa de hoy. Se
//     acepta porque es un indicador de reporte y no un recibo; el detalle
//     está más abajo.
// ───────────────────────────────────────────────────────────────────────

/** Una línea vendida, con lo mínimo que hace falta para la cuenta. */
export type LineaVendida = {
  productId: string;
  /** `sale_lines.currency`: 'USD' | 'EUR' | 'COP'. Texto, como la columna. */
  currency: string;
  unitPrice: number;
  quantity: number;
};

/** Lo que de un producto hace falta para saber qué le costó. */
export type CostoDeProducto = {
  costo: number | null;
  /** `products.cost_currency`, que puede ser 'OTHER'. */
  monedaCosto: string | null;
};

export type Dinero = { currency: string; amount: number };

/**
 * El costo de un producto expresado en la moneda en la que se vendió.
 *
 * `null` en los tres casos de la cabecera. No devuelve 0 nunca: un costo
 * desconocido no es un costo de cero, y tratarlo así haría que la ganancia
 * fuera igual al precio entero -- una cifra enorme y falsa justo en los
 * productos a los que les falta el dato.
 */
export function costoEnMonedaDeVenta(
  p: CostoDeProducto,
  destino: string,
  rates: BolivarRates | null,
): number | null {
  if (p.costo == null || !(p.costo > 0)) return null;
  // `cost_currency` nulo significa dólares: es el mismo supuesto que ya hace
  // el cálculo del capital en `inventario.ts`, y cambiarlo aquí daría dos
  // capitales distintos para el mismo producto.
  const desde = p.monedaCosto ?? "USD";
  if (desde === "OTHER") return null;
  if (desde === destino) return p.costo;
  if (rates == null) return null;
  return priceIn(destino as PriceCurrency, { amount: p.costo, currency: desde as PriceCurrency }, rates)
    .amount;
}

/** Lo que un producto vendió y lo que dejó, repartido por moneda de venta. */
export type CuentaDeProducto = {
  ingresos: Record<string, number>;
  /**
   * Lo que costó lo vendido, SOLO de las líneas que se pudieron valorar.
   *
   * NO ES `ingresos − ganancia`, y por eso se guarda aparte: `ingresos`
   * incluye las líneas sin costo escrito y `ganancia` no, así que esa resta
   * daría un costo inflado justo en los productos a los que les falta el
   * dato. Es el denominador del margen, y un denominador equivocado no se
   * nota: devuelve un porcentaje perfectamente creíble.
   */
  costo: Record<string, number>;
  ganancia: Record<string, number>;
  /** Cuántas de sus líneas no se pudieron valorar. Ver la cabecera. */
  lineasSinCosto: number;
};

/**
 * Reparte las líneas vendidas por producto y saca de cada una sus ingresos y
 * su ganancia, POR MONEDA DE VENTA.
 *
 * POR MONEDA Y NO EN UNA SUMA, que es la regla de toda esta app: dólares y
 * euros son dos libros y no se suman. Quien pinte esto elige una --la de más
 * ingresos, con `monedaPrincipal`-- en vez de mezclarlas.
 */
export function cuentasPorProducto(
  lineas: readonly LineaVendida[],
  costos: ReadonlyMap<string, CostoDeProducto>,
  rates: BolivarRates | null,
): Map<string, CuentaDeProducto> {
  const out = new Map<string, CuentaDeProducto>();
  for (const l of lineas) {
    const p = costos.get(l.productId);
    if (!p) continue;
    let c = out.get(l.productId);
    if (!c) {
      c = { ingresos: {}, costo: {}, ganancia: {}, lineasSinCosto: 0 };
      out.set(l.productId, c);
    }
    const ingreso = l.unitPrice * l.quantity;
    c.ingresos[l.currency] = (c.ingresos[l.currency] ?? 0) + ingreso;

    const costoUnidad = costoEnMonedaDeVenta(p, l.currency, rates);
    if (costoUnidad == null) {
      // LOS INGRESOS SÍ CUENTAN Y LA GANANCIA NO. Es deliberado: «Total
      // vendido» es verdad aunque no sepamos el costo, y meter esta línea en
      // la ganancia con costo cero la inflaría. Se anota aparte para poder
      // decir que la cifra está incompleta en vez de darla por entera.
      c.lineasSinCosto++;
      continue;
    }
    const costo = costoUnidad * l.quantity;
    c.costo[l.currency] = (c.costo[l.currency] ?? 0) + costo;
    c.ganancia[l.currency] = (c.ganancia[l.currency] ?? 0) + (ingreso - costo);
  }
  return out;
}

/**
 * La moneda en la que más se vendió, que es la que se enseña.
 *
 * SE ELIGE POR INGRESOS Y NO POR GANANCIA, y la diferencia importa: una
 * ganancia NEGATIVA --vender por debajo del costo, que pasa-- quedaría
 * escondida si se eligiera el máximo de la ganancia. Lo que el tendero
 * necesita ver es justo esa.
 */
export function monedaPrincipal(ingresos: Record<string, number>): string | null {
  const filas = Object.entries(ingresos).filter(([, v]) => v > 0);
  if (!filas.length) return null;
  filas.sort((a, b) => b[1] - a[1]);
  return filas[0][0];
}

/**
 * Lo mismo que `cuentasPorProducto` pero sumado de un grupo de productos:
 * lo que necesita una fila de «Proveedores».
 */
export function sumarCuentas(cuentas: readonly CuentaDeProducto[]): CuentaDeProducto {
  const total: CuentaDeProducto = { ingresos: {}, costo: {}, ganancia: {}, lineasSinCosto: 0 };
  for (const c of cuentas) {
    for (const [m, v] of Object.entries(c.ingresos)) total.ingresos[m] = (total.ingresos[m] ?? 0) + v;
    for (const [m, v] of Object.entries(c.costo)) total.costo[m] = (total.costo[m] ?? 0) + v;
    for (const [m, v] of Object.entries(c.ganancia)) total.ganancia[m] = (total.ganancia[m] ?? 0) + v;
    total.lineasSinCosto += c.lineasSinCosto;
  }
  return total;
}

/**
 * El margen real de un grupo: lo que ganó SOBRE LO QUE LE COSTÓ, en %.
 *
 * Decisión del dueño el 2026-10-28 para la fila de proveedor, elegida entre
 * tres: *«margen real de las ventas»*, no el porcentaje que él escribió en
 * cada ficha. Sabiendo lo que cuesta: un proveedor cuyos productos no se
 * vendieron en el periodo sale **sin margen** --«—»-- y no en 0 %.
 *
 * ───────────────────────────────────────────────────────────────────────
 * SOBRE EL COSTO Y NO SOBRE LA VENTA, Y ESA ES LA PARTE QUE SE ROMPIÓ
 *
 * Esto dividía entre los INGRESOS hasta el 2026-10-28. Daba un número
 * perfectamente creíble y era otro margen: un producto comprado a 100 y
 * vendido a 130 salía 23,08 % en vez de 30 %.
 *
 * Y 30 es el que dice el resto de la app. `marginFromPrice` --la que lee el
 * margen de la ficha-- hace `(price − cost) / cost`, y `suggestedPrice` hace
 * `cost × (1 + pct/100)`, con esta razón escrita al lado desde el principio:
 * *«El margen es sobre el COSTO, que es como lo dijeron los dos tenderos: "al
 * monto que me costó le aplico un 30 %". No es margen sobre el precio de
 * venta, que daría otro número y es la confusión clásica de esta cuenta»*.
 *
 * LO CARO NO ERA EL NÚMERO, ERA DÓNDE SALÍA: la pestaña «Proveedores» dice
 * «Margen: 23,08 %» de Éxito y la pestaña de al lado, «Margen por producto»,
 * lista esos mismos productos al 30 %. Dos cifras con el mismo nombre
 * contradiciéndose a un toque de distancia, y nada en pantalla que explique
 * cuál creer. Salió al ir a escribir el subtítulo que dice cómo se calcula --
 * que es lo que un texto honesto obliga a comprobar.
 *
 * ───────────────────────────────────────────────────────────────────────
 * UN PORCENTAJE SÍ PUEDE CRUZAR MONEDAS, Y UNA SUMA DE DINERO NO
 *
 * Parece contradecir la regla de no sumar monedas, y no lo hace: aquí no se
 * entrega una cifra en ninguna moneda, se entrega una RAZÓN. Para calcularla
 * hay que llevar los dos lados a una unidad común, y la que esta app ya usa
 * para pasar de una moneda a otra es el bolívar.
 *
 * `null` cuando no se puede: sin tasas y con más de una moneda en juego, o
 * sin un solo costo valorado. Y SOLO CUENTAN las líneas cuya ganancia se
 * pudo calcular, numerador y denominador a la vez -- ver `CuentaDeProducto`.
 */
export function margenReal(
  c: CuentaDeProducto,
  rates: BolivarRates | null,
): number | null {
  const monedas = Object.keys(c.costo).filter((m) => (c.costo[m] ?? 0) > 0);
  if (!monedas.length) return null;

  // Con una sola moneda no hace falta tasa ninguna, que es el caso de un
  // negocio colombiano -- y el de cualquiera que venda solo en dólares.
  if (monedas.length === 1) {
    const m = monedas[0];
    return ((c.ganancia[m] ?? 0) / c.costo[m]) * 100;
  }

  if (rates == null) return null;
  let costoBs = 0;
  let ganBs = 0;
  for (const m of monedas) {
    const unidad = priceIn("VES", { amount: 1, currency: m as PriceCurrency }, rates).amount;
    if (unidad == null) return null;
    costoBs += c.costo[m] * unidad;
    ganBs += (c.ganancia[m] ?? 0) * unidad;
  }
  if (!(costoBs > 0)) return null;
  return (ganBs / costoBs) * 100;
}

// ═══════════════════════════════════════════════════════════════════════
// UNA MONEDA DE REPORTE PUEDE NO SER UNA MONEDA DE LA APP
//
// `products.cost_currency` admite `'OTHER'`, y entonces la moneda de verdad
// vive en `cost_currency_other`, que es TEXTO LIBRE que el tendero escribe.
// El capital se agrupa por esa cadena --lo decidió `inventario.ts`: *«se
// respeta tal cual en vez de aplanarla a la de la casa: mezclarla sería
// inventar una conversión que nadie pidió»*-- así que una clave de estos
// montones puede ser «pesos argentinos» o cualquier cosa.
//
// ───────────────────────────────────────────────────────────────────────
// LO QUE PASABA SIN ESTO, Y NO ERA COSMÉTICO
//
// Medido en dev el 2026-10-28, con la hoja de «Productos disponibles»
// abierta: su segunda tarjeta salía con el importe **vacío** y sin bandera.
//
//   · `formatPriceAmount` es un `switch` exhaustivo sobre las cinco monedas
//     de la app. Con una cadena que no es ninguna no entra en ningún `case`
//     y devuelve `undefined`, que React pinta como nada.
//   · `CurrencyFlagIcon` es peor: `FLAG_SRC[clave]` da `undefined` y
//     `next/image` pinta un `<img>` SIN `src`. Su propia cabecera lo tiene
//     escrito desde el 2026-10-16: *«React's own warning that an empty `src`
//     makes the browser DOWNLOAD THE WHOLE PAGE AGAIN -- on a phone»*.
//
// Y NO ES SOLO DE LAS HOJAS NUEVAS: el chip de la tarjeta de la pestaña usa
// la misma cuenta, así que le pasaría lo mismo el día que esa moneda sea la
// de más dinero. Estaba armado y no había disparado.
// ═══════════════════════════════════════════════════════════════════════

const CONOCIDAS = new Set<string>(["USD", "EUR", "COP", "VES", "USDT"]);

/** `true` si la app sabe formatearla y tiene bandera para ella. */
export function esMonedaConocida(c: string): c is PriceCurrency {
  return CONOCIDAS.has(c);
}

/**
 * El importe con su moneda, sepa la app de ella o no.
 *
 * Con una moneda libre escribe el número y el texto que el tendero puso --
 * «1.234,00 pesos argentinos»--. Es feo y es verdad, que es el orden correcto
 * de prioridades: la alternativa que había era un hueco donde debía ir una
 * cifra de dinero.
 */
export function formatDinero(d: Dinero): string {
  if (esMonedaConocida(d.currency)) return formatPriceAmount(d.amount, d.currency);
  return `${formatBsAmount(d.amount)} ${d.currency}`;
}
