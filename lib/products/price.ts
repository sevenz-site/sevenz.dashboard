import { formatBs, formatBsAmount, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";

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
// Orden del frame 1187:3728: Dólar, Euro, USDT. Bolívares va al final, que
// es donde cae lo que solo se calcula.
export const VE_PRICE_CURRENCIES: PriceCurrency[] = ["USD", "EUR", "USDT", "VES"];

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

// ── Parsing what somebody typed, and what the database returned ──────────
//
// TWO RULES, IN THIS ORDER:
//
//   1. A separator with EXACTLY THREE DIGITS after it, with no separator of
//      the other kind anywhere, is a THOUSANDS separator.
//   2. Otherwise, the LAST separator is the decimal one and the rest are
//      thousands.
//
// Both rules were paid for on 2026-10-10, each by a bug found running the
// screen.
//
// ─────────────────────────────────────────────────────────────────────────
// RULE 2 EXISTS BECAUSE OF A MONEY BUG
//
// The first implementation was `value.replace(/\./g, "").replace(",", ".")`:
// a dot was ALWAYS thousands. Right for what a Venezuelan types ("1.234,56"),
// catastrophically wrong for what the database hands back, because a JS number
// stringifies with a DOT. A wholesale price of 11.5 came back as "11.5", lost
// its dot, and became 115. The form showed a margin of 1.050 % instead of
// 15 %, and the same parser on the server would have written 115 into the row:
// an $11,50 product turned into a $115 one just by being opened and saved.
//
// ─────────────────────────────────────────────────────────────────────────
// AND RULE 1 EXISTS BECAUSE RULE 2 ALONE BROKE BOLÍVARES
//
// With only rule 2, "12.000" — twelve thousand bolívares, exactly how it is
// written here — parsed as 12. That is the wrong trade for THIS product: a
// bolívar price is always in the thousands, and a price with three decimals is
// not something anybody types. So a three-digit group wins.
//
// What this costs, said out loud: you cannot type "12.000" and mean twelve
// point zero zero zero. You type "12". Nobody does the former; plenty of
// people do "12.000" meaning twelve thousand.
//
//   "11.5"       → 11.5       the database, and anyone typing in English
//   "11,5"       → 11.5       what a Venezuelan types
//   "12.000"     → 12000      twelve thousand bolívares
//   "12,000"     → 12000      same, other separator
//   "1.234,56"   → 1234.56    two separators: the last one decides
//   "1,234.56"   → 1234.56    and it works the other way round too
//   "1.234.567"  → 1234567    several of the same: all thousands
//
// Shared by the form and the server action on purpose. Two copies of a money
// parser is two chances to fix only one of them.
export function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);

  let normalised: string;
  if (decimalAt === -1) {
    normalised = raw;
  } else {
    const soloUnTipo = lastDot === -1 || lastComma === -1;
    const digitosDetras = raw.length - decimalAt - 1;
    if (soloUnTipo && digitosDetras === 3) {
      // Regla 1: agrupación de miles. El número es entero.
      normalised = raw.replace(/[.,]/g, "");
    } else {
      // Regla 2: el último separador es el decimal.
      const whole = raw.slice(0, decimalAt).replace(/[.,]/g, "");
      normalised = `${whole}.${raw.slice(decimalAt + 1)}`;
    }
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored number put back into a text field, written the way this product
 * writes numbers everywhere else.
 *
 * It also has to survive `parseAmount` reading it back, and that is not free:
 * a value with EXACTLY THREE decimals — 1,125 kilos, which `stock_opening`
 * allows since it is numeric(14,3) — would hit rule 1 above and come back as
 * 1125. So three decimals get a fourth, a zero, which is the same number and
 * is unambiguous. Four digits after the separator can only be decimals.
 *
 * Checked by the round-trip case in `qa/product-price.mjs`, because this is
 * precisely the kind of pairing that survives one half being changed.
 */
export function formatAmountForInput(value: number | null | undefined): string {
  if (value == null) return "";
  const texto = String(value);
  const punto = texto.indexOf(".");
  const conDecimales =
    punto !== -1 && texto.length - punto - 1 === 3 ? `${texto}0` : texto;
  return conDecimales.replace(".", ",");
}

// ── Formatting ───────────────────────────────────────────────────────────
//
// Reuses the formatters the rest of the product already uses, instead of
// building a second style for the catalogue. `formatBs` exists because ICU
// renders the VES symbol differently across environments and the design doc
// always shows a literal "Bs. "; `formatCurrency` is the Colombian peso.
//
// USDT gets its unit AFTER the number — "12,00 USDT" — and not a symbol. The
// ₮ sign is unknown to almost everybody, and DESIGN-SYSTEM.md's rule is that
// the unit travels on the amount so a bare number beside a percentage is not
// read as a second percentage.
export function formatPriceAmount(amount: number, currency: PriceCurrency): string {
  switch (currency) {
    case "COP":
      return formatCurrency(amount);
    case "VES":
      return formatBs(amount);
    case "USD":
    case "EUR":
      return formatDisplayCurrency(amount, currency);
    case "USDT":
      return `${formatBsAmount(amount)} USDT`;
  }
}

// UN PORCENTAJE TAMBIÉN SE FORMATEA, y esto ya mordió aquí.
//
// `{margen}%` en crudo imprime "33.33%" — punto inglés — justo al lado de las
// cifras que el resto de la pantalla formatea en español. Es literalmente la
// trampa que DESIGN-SYSTEM.md describe: «un `toFixed()` al lado de un número
// formateado imprime un punto decimal inglés junto a una coma española».
// Encontrado rindiendo la ficha el 2026-10-09.
//
// Sin decimales cuando son redondos: «30 %» y no «30,00 %», porque el margen
// se piensa en números enteros y dos ceros fijos lo hacen parecer medido.
const percentFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)} %`;
}

// EL RÓTULO DE CADA FILA, y la palabra importa.
//
// Decisión del dueño, 2026-10-09: las monedas calculadas se llaman
// **equivalencias**, no precios. El caso que lo motivó: con el BCV a 160 y el
// USDT a 200, un producto de $12 enseña 9,60 USDT. Es correcto —$12 al BCV son
// Bs. 1.920, y con eso se compran 9,60 USDT porque el USDT está más caro— pero
// un tendero lo lee como un error, porque en su cabeza un USDT es un dólar.
//
// La palabra «equivalencia» es lo que lo arregla: no dice «esto cuesta 9,60
// USDT», dice «esto equivale hoy a 9,60 USDT». Se descartó esconder la fila a
// quien esté en BCV automático, porque sería esconder información cierta.
export function priceRowLabel(currency: PriceCurrency, origin: PriceInCurrency["origin"]): string {
  const name = currency === "VES" ? "bolívares" : currency === "USDT" ? "USDT" : currency;
  if (origin === "base") return `Precio en ${name}`;
  if (origin === "manual") return `Precio fijado en ${name}`;
  return `Equivalencia en ${name}`;
}
