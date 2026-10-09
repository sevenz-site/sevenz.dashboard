import type { LedgerCurrency } from "@/lib/types";

// EL PRECIO DE UN PRODUCTO EN CADA MONEDA.
//
// Decisión del dueño, 2026-10-09: la ficha enseña el precio en todas las
// monedas, calculado a partir del que él tecleó, **y cada uno se puede fijar a
// mano** con un candado que lo desvincula del cálculo y se puede volver a
// abrir. Ver ../docs/INVENTARIO-PLAN.md, decisiones 14 y 16.
//
// ─────────────────────────────────────────────────────────────────────────
// TODO PIVOTA SOBRE EL BOLÍVAR, Y NO POR GUSTO
//
// Las tasas que Sevenz tiene son todas "bolívares por una unidad de X": el BCV
// publica Bs/USD y Bs/EUR, y CriptoYa da Bs/USDT. No existe una tasa USD→EUR
// en ningún sitio del producto.
//
// Así que para pasar de dólares a euros se va a bolívares y se vuelve. Hacerlo
// de otra forma significaría inventarse una tasa cruzada, que es justo lo que
// `resolve-movement-rate.ts` evita al guardar las dos por separado en cada
// movimiento.
//
// ─────────────────────────────────────────────────────────────────────────
// COLOMBIA NO TIENE EQUIVALENCIAS, Y ESO NO ES UN HUECO
//
// Un negocio colombiano cobra en pesos y no tiene tasa de ninguna clase: no hay
// Bs/COP porque no hay bolívares de por medio. Su ficha enseña un precio y ya.
//
// Se escribe aquí y no se descubre en pantalla porque la tentación de "poner
// algo" en esos huecos es real, y cualquier cosa que se ponga sería inventada.
export type PriceCurrency = "COP" | "USD" | "EUR" | "USDT" | "VES";

export type PriceTier = "retail" | "wholesale";

// Bolívares por una unidad de cada moneda. `usdt` sale del precio de COMPRA
// (`ask` de Binance P2P) — decisión del dueño el 2026-10-09: es lo que al
// cliente le cuesta conseguir ese USDT para pagar, y si se equivoca lo hace a
// favor del tendero, que es de quien es el dinero.
export type BolivarRates = {
  usd: number;
  eur: number;
  // null cuando CriptoYa no respondió o devolvió un precio fuera de banda. No
  // es un error: la ficha enseña el resto y deja ese hueco dicho.
  usdt: number | null;
};

export type PriceInCurrency = {
  currency: PriceCurrency;
  // null cuando no se puede calcular: falta la tasa, o el negocio es
  // colombiano y la moneda no es la suya.
  amount: number | null;
  // `base` es la que el tendero tecleó; `manual` es una que fijó con el
  // candado; `derived` sale de las tasas.
  origin: "base" | "manual" | "derived";
};

// Las monedas que una ficha venezolana enseña, en el orden en que se leen.
// COP no está: un negocio colombiano no convive con ninguna de estas.
export const VE_PRICE_CURRENCIES: PriceCurrency[] = ["USD", "USDT", "EUR", "VES"];

// Bolívares por una unidad de `currency`. 1 para el propio bolívar.
function bolivaresPorUnidad(currency: PriceCurrency, rates: BolivarRates): number | null {
  switch (currency) {
    case "VES":
      return 1;
    case "USD":
      return rates.usd > 0 ? rates.usd : null;
    case "EUR":
      return rates.eur > 0 ? rates.eur : null;
    case "USDT":
      return rates.usdt && rates.usdt > 0 ? rates.usdt : null;
    case "COP":
      // No existe Bs/COP, y no se inventa. Ver la cabecera.
      return null;
  }
}

// Dos decimales, redondeo normal. La misma regla que `convertirDesdeBolivares`
// usa al guardar un movimiento tecleado en bolívares, y por el mismo motivo:
// redondear "a favor del dueño" daría resultados distintos según el sentido de
// la conversión, y eso no hay forma de explicárselo a un cliente que rehace la
// cuenta.
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * El precio de un producto en una moneda concreta.
 *
 * El orden de precedencia es el único que respeta el candado: si el tendero
 * fijó un número a mano, ese número manda y no se recalcula nunca. Lo contrario
 * —recalcular por detrás un precio que alguien puso a propósito— es la clase de
 * cosa que hace que se deje de confiar en la pantalla.
 */
export function priceIn(
  currency: PriceCurrency,
  base: { amount: number; currency: PriceCurrency },
  rates: BolivarRates,
  // Lo que el tendero fijó a mano, por moneda. Una entrada aquí es un candado
  // cerrado; su ausencia es un candado abierto.
  overrides: Partial<Record<PriceCurrency, number>> = {},
): PriceInCurrency {
  const manual = overrides[currency];
  if (manual != null && manual > 0) {
    return { currency, amount: redondear(manual), origin: "manual" };
  }

  if (currency === base.currency) {
    return { currency, amount: redondear(base.amount), origin: "base" };
  }

  const bsPorBase = bolivaresPorUnidad(base.currency, rates);
  const bsPorDestino = bolivaresPorUnidad(currency, rates);
  if (bsPorBase == null || bsPorDestino == null) {
    return { currency, amount: null, origin: "derived" };
  }

  return {
    currency,
    amount: redondear((base.amount * bsPorBase) / bsPorDestino),
    origin: "derived",
  };
}

/**
 * La fila entera de la ficha: el precio en cada moneda que este negocio usa.
 *
 * Un negocio colombiano recibe una sola entrada, la suya. Uno venezolano recibe
 * las cuatro, y las que no se puedan calcular vienen con `amount: null` en vez
 * de omitirse — porque un hueco explicado («ahora mismo no tenemos el precio
 * del USDT») se lee distinto a una moneda que simplemente no aparece.
 */
export function allPrices(
  base: { amount: number; currency: PriceCurrency },
  rates: BolivarRates,
  overrides: Partial<Record<PriceCurrency, number>> = {},
): PriceInCurrency[] {
  if (base.currency === "COP") {
    return [{ currency: "COP", amount: redondear(base.amount), origin: "base" }];
  }
  return VE_PRICE_CURRENCIES.map((c) => priceIn(c, base, rates, overrides));
}

/**
 * El precio que sugiere un costo y un margen.
 *
 * NO escribe el precio: lo sugiere. Decidido el 2026-10-09 — si el tendero
 * tecleó un precio, ese es el precio, y costo y margen sirven para calcular la
 * ganancia y para proponer uno cuando no hay. Reescribirle por detrás un número
 * que puso a mano sería lo mismo que ignorar un candado.
 *
 * El margen es sobre el COSTO, que es como lo dijeron los dos tenderos: «al
 * monto que me costó le aplico un 30 %». No es margen sobre el precio de venta,
 * que daría otro número y es la confusión clásica de esta cuenta.
 */
export function suggestedPrice(cost: number, marginPct: number): number | null {
  if (!(cost > 0) || !(marginPct >= 0)) return null;
  return redondear(cost * (1 + marginPct / 100));
}

/**
 * La ganancia de vender a `price` algo que costó `cost`, en tanto por ciento.
 *
 * Devuelve null sin costo, que es el caso de todo producto que nació dentro de
 * un fiado: esos llevan precio pero no costo. Esa es la señal útil que
 * sustituyó al «¿cargamos estos productos?» descartado — no pide re-trabajo,
 * solo dice que de ese producto todavía no se sabe la ganancia.
 */
export function marginFromPrice(cost: number | null, price: number): number | null {
  if (cost == null || !(cost > 0) || !(price > 0)) return null;
  return redondear(((price - cost) / cost) * 100);
}
