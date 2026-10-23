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

// TEMPORARILY LOCKED SALE CURRENCIES -- CT-79, and this is the whole lock.
//
// WHY IT EXISTS. `catalog_order_items.currency` accepts USDT (migration 108)
// while `movements.currency` is `check (currency in ('USD','EUR'))` (migration
// 025). With a USDT sale price published, a client could order in a currency
// the money ledger cannot store, and the shopkeeper would be left holding an
// order he cannot register. The owner decided on 2026-10-16 to hide it rather
// than remove it, so the catalogue can ship to production before the third
// ledger exists.
//
// COST IN USDT IS NOT LOCKED, at the owner's request the same day: USDT stays
// as a cost currency for margin, and the rate strip that already ships in
// production keeps showing the USDT price. So the app shows a USDT rate and
// takes a USDT cost while refusing a USDT sale price. That is inconsistent on
// screen, deliberately, and it is written here so it does not read as a bug.
//
// TO UNDO: empty this array. Nothing else. It is read by the product dialog
// (what can be added, and what an existing product can still edit) and by the
// product server action, which refuses it -- because a lock that lives only in
// a menu is not a lock: the server action took whatever the form sent. Undo it
// only AFTER `movements` can hold USDT, never before and not at the same time.
export const SALE_CURRENCIES_LOCKED: PriceCurrency[] = ["USDT"];

export function isSaleCurrencyLocked(currency: PriceCurrency): boolean {
  return SALE_CURRENCIES_LOCKED.includes(currency);
}

// THE FIRST ONE IS NEVER DROPPED, and that is the point of this helper rather
// than a plain `filter`. Index 0 is that tier's base -- the currency its price
// is actually stored in, by `currenciesOf`'s contract -- so removing it would
// not hide a currency, it would REPRICE the product: the same number, read as
// a different currency, with nothing on screen saying so. That is the worst
// failure this area can produce, and it is why the lock is expressed as "drop
// the extras" instead of "drop the locked ones".
//
// Measured in dev on 2026-10-16 before writing this: of 11 live products, 2
// carry USDT (`Alicate`, `Casco`) and ZERO have it as a base, with zero prices
// pinned in USDT. So the case this guard protects is unreachable today -- it
// is here because "unreachable today" is exactly what the per-tier base work
// of migration 114 turned into a real bug the week before.
export function withoutLockedSaleCurrencies(list: PriceCurrency[]): PriceCurrency[] {
  return list.filter((currency, i) => i === 0 || !isSaleCurrencyLocked(currency));
}

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
export function marginFromPrice(
  cost: number | null,
  // ═══════════════════════════════════════════════════════════════════════
  // LAS MONEDAS NO SON OPCIONALES, Y ESO ES EL ARREGLO DE UN FALLO
  //
  // Esta función tomaba dos números sueltos y dividía uno entre otro. Con un
  // costo en dólares y un precio en euros, eso restaba euros menos dólares y
  // devolvía un porcentaje que no significaba nada.
  //
  // Lo reportó el dueño el 2026-10-22: *«seteó precio en dólares e intentó
  // agregar margen en euros, el dropdown no cambió el valor del porcentaje
  // seleccionado pero sí lo aplicó al precio»*. Esa es exactamente la forma
  // del fallo: `priceFromCost` --la que ESCRIBE el precio-- sí convierte el
  // costo a la moneda destino, y esta --la que LEE el margen de vuelta-- no.
  // El precio salía bien y el desplegable se quedaba en lo de antes, porque
  // el porcentaje que calculaba no coincidía con ningún preajuste.
  //
  // LAS MONEDAS ENTRAN POR LA FIRMA, no por un `if` dentro: así quien la
  // llame no puede olvidarlas, que es como volvió a pasar en dos sitios.
  costCurrency: CostCurrency | null,
  price: number,
  priceCurrency: PriceCurrency,
  rates: BolivarRates | null,
): number | null {
  if (cost == null || !(cost > 0) || !(price > 0)) return null;

  // Un costo en «Otro» no se puede convertir --no tenemos su tasa-- así que
  // no hay margen que calcular. Devolver un número aquí sería inventarlo.
  if (costCurrency == null || costCurrency === "OTHER") return null;

  const enLaMonedaDelPrecio =
    costCurrency === priceCurrency
      ? cost
      : rates == null
        ? null
        : priceIn(priceCurrency, { amount: cost, currency: costCurrency }, rates).amount;
  if (enLaMonedaDelPrecio == null || !(enLaMonedaDelPrecio > 0)) return null;

  return redondear(((price - enLaMonedaDelPrecio) / enLaMonedaDelPrecio) * 100);
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
 *
 * ── THE TWO OPTIONS, AND WHY THEY ARE OPTIONS ───────────────────────────
 *
 * Added 2026-10-23, asked for by the owner about ONE field: the «Monto» of the
 * payment sheet, which opened showing `5760,4761499999` — the sale's total
 * converted to bolívares, with every digit the division left behind. His
 * words: *«ese campo usa decimales pero no separador de miles, agrega los
 * separadores de miles y los decimales a máximo 4»*.
 *
 * They are OPTIONS and not the new default because this function also fills
 * every field of the product form — price, cost, stock, minimum quantity —
 * and nobody asked for those to change. Defaults off means that form keeps
 * rendering exactly what it rendered yesterday, and the diff cannot reach it.
 *
 * `maxDecimales: 4` is not an arbitrary cut: `price_retail`, `price_wholesale`,
 * `cost` and `unit_price` are all `numeric(14, 4)`, so four decimals is the
 * precision the database itself keeps. A fifth digit in that field was never
 * going to be stored.
 *
 * GROUPING SURVIVES THE ROUND TRIP, and it is worth saying why rather than
 * trusting it: with thousands separators the integer `1125` is written
 * `1.125`, which `parseAmount` reads by rule 1 (one kind of separator, last
 * group of three) and returns 1125. The decimal `1.125` is still written
 * `1,1250` by the paragraph above, which is rule 2. The two never collide
 * because the zero-padding keeps a real decimal from ever showing exactly
 * three digits. `qa:product-price` checks both halves.
 */
export function formatAmountForInput(
  value: number | null | undefined,
  opciones?: { miles?: boolean; maxDecimales?: number },
): string {
  if (value == null) return "";

  const { miles = false, maxDecimales } = opciones ?? {};
  const redondeado = maxDecimales != null ? Number(value.toFixed(maxDecimales)) : value;
  const texto = String(redondeado);

  // Exponential notation — `String(1e21)` is `"1e+21"` — would be mangled by
  // everything below. It comes back as it always did: out of this product's
  // range, and not a case this change is here to improve.
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return texto.replace(".", ",");

  const punto = texto.indexOf(".");
  const conDecimales = punto !== -1 && texto.length - punto - 1 === 3 ? `${texto}0` : texto;

  if (!miles) return conDecimales.replace(".", ",");

  const [entera, decimales] = conDecimales.split(".");
  const signo = entera.startsWith("-") ? "-" : "";
  const digitos = signo ? entera.slice(1) : entera;
  const agrupada = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimales ? `${signo}${agrupada},${decimales}` : `${signo}${agrupada}`;
}

/**
 * The same number, grouped WHILE IT IS BEING TYPED.
 *
 * Asked for by the owner on 2026-10-23, right after the field stopped opening
 * with `5760,4761499999`: *«agrupa también mientras se teclea»*. So the amount
 * reads the same whether the app filled it in or the shopkeeper did.
 *
 * ── WHY IT NEEDS THE PREVIOUS VALUE, which is the whole difficulty ───────
 *
 * Type `12345`. After the fourth digit the field already shows `1.234`.
 * Inserting the `5` makes the raw value `1.2345` — and read by `parseAmount`'s
 * «the last separator decides», that is ONE POINT TWO THREE FOUR FIVE, not
 * twelve thousand. The text alone cannot tell our own grouping mark from a
 * decimal point the shopkeeper just pressed.
 *
 * So the rule is: **what was typed decides**.
 *
 *   · one character inserted, and it is `.` or `,` → that is the decimal mark,
 *     exactly where it was pressed;
 *   · one character inserted or removed, anything else → the decimal mark is
 *     the last comma, and every dot is ours;
 *   · anything bigger (a paste, select-all-and-replace) → hand it to
 *     `parseAmount`, which already knows both conventions, and re-format.
 *
 * A typed `.` is therefore honoured as a decimal mark, which it has to be: an
 * Android keypad offers it even on a Spanish phone, and this field accepted it
 * before.
 *
 * ── WHAT IT DELIBERATELY KEEPS, because formatting must not fight typing ──
 *
 * A trailing separator with nothing after it (`5760,`) and trailing zeros
 * (`5,10`) survive. Collapsing them would undo the keystroke the shopkeeper
 * just made, which is how these fields end up feeling broken.
 *
 * Returns the caret too: the caller has to put it back, because the input is
 * controlled and React would otherwise drop it at the end on every keystroke.
 */
export function formatAmountWhileTyping(
  bruto: string,
  anterior: string,
  cursor: number,
  maxDecimales = 4,
): { texto: string; cursor: number } {
  const limpio = bruto.replace(/[^\d.,]/g, "");
  if (limpio === "") return { texto: "", cursor: 0 };

  const cambio = bruto.length - anterior.length;

  // Lo que de verdad ancla el cursor son los DÍGITOS que quedan a su
  // izquierda: los puntos de agrupación los pone y los quita esta función, así
  // que contarlos haría saltar el cursor con cada millar que aparece.
  let digitosAntes = (bruto.slice(0, cursor).match(/\d/g) ?? []).length;

  // ── BORRAR UN PUNTO DE AGRUPACIÓN BORRA EL DÍGITO DE SU IZQUIERDA ──────
  //
  // Sin esto, el retroceso sobre un punto no hace NADA visible: se quita el
  // punto, se reformatea y vuelve a salir. El tendero pulsa tres veces y el
  // número sigue igual, que es la queja clásica de un campo agrupado.
  let digitos = limpio;
  if (cambio === -1 && anterior[cursor] === ".") {
    digitos = (bruto.slice(0, cursor - 1) + bruto.slice(cursor)).replace(/[^\d.,]/g, "");
    digitosAntes = Math.max(0, digitosAntes - 1);
  }

  let enteros: string;
  let decimales: string | null;
  // Dónde quedó el separador decimal DENTRO DE `bruto`, para saber si el
  // cursor lo pasó o no. -1 cuando todavía no hay decimales.
  let separadorEn = -1;

  const insertadoUno = cambio === 1 ? bruto[cursor - 1] : null;

  if (insertadoUno === "." || insertadoUno === ",") {
    // Acaba de pedir decimales, justo ahí.
    separadorEn = cursor - 1;
    enteros = digitos.slice(0, separadorEn).replace(/[.,]/g, "");
    decimales = digitos
      .slice(separadorEn + 1)
      .replace(/[.,]/g, "")
      .slice(0, maxDecimales);
  } else if (Math.abs(cambio) <= 1) {
    // Una tecla normal, o un borrado. La coma manda; los puntos son nuestros.
    const coma = digitos.lastIndexOf(",");
    if (coma === -1) {
      enteros = digitos.replace(/[.,]/g, "");
      decimales = null;
    } else {
      separadorEn = coma;
      enteros = digitos.slice(0, coma).replace(/[.,]/g, "");
      decimales = digitos
        .slice(coma + 1)
        .replace(/[.,]/g, "")
        .slice(0, maxDecimales);
    }
  } else {
    // Un pegado, o un reemplazo entero. Aquí no hay pulsación que interpretar,
    // así que decide quien ya sabe leer las dos convenciones.
    const n = parseAmount(digitos);
    const texto = n == null ? "" : formatAmountForInput(n, { miles: true, maxDecimales });
    return { texto, cursor: texto.length };
  }

  const sinCerosDeMas = enteros.replace(/^0+(?=\d)/, "");
  const agrupados = sinCerosDeMas.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const texto = decimales === null ? agrupados : `${agrupados},${decimales}`;

  // ── EL CURSOR, DE VUELTA ───────────────────────────────────────────────
  //
  // Se avanza por el texto nuevo hasta dejar atrás los mismos dígitos que
  // había a la izquierda del cursor. Y SI EL SEPARADOR DECIMAL QUEDÓ DETRÁS,
  // se pasa también por encima de él: sin eso, teclear la coma deja el cursor
  // DELANTE, y el siguiente dígito entra en los enteros. Era el fallo de
  // `12.5`, que salía `125,`.
  const pasoElSeparador = separadorEn !== -1 && separadorEn < cursor;
  let vistos = 0;
  let destino = 0;
  while (destino < texto.length && vistos < digitosAntes) {
    // DÍGITOS, no «todo lo que no sea punto»: contando la coma, cada decimal
    // nuevo aterrizaba pegado a ella y los dígitos salían del revés —
    // `5760,4761` se escribía `5.760,1674`.
    if (texto[destino] >= "0" && texto[destino] <= "9") vistos++;
    destino++;
  }
  if (pasoElSeparador && texto[destino] === ",") destino++;

  return { texto, cursor: destino };
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

// THE CURRENCY'S NAME IN WORDS, for labelling a figure.
//
// From the owner's request of 2026-10-16: an order's total must always say
// its currency, whether the order carries one or three -- «Total en dólares»,
// never a bare «Total». The ISO code does not do that job: "Total en USD" is
// bank vocabulary and the person reading that screen is a shopkeeper.
//
// It lives here rather than in the screen because a loose copy of this same
// decision already existed -- the `destino === "USD" ? "dólares" : "euros"`
// ternary in `lib/exchange-rate/monto-en-bolivares.ts` -- and two copies of
// one table end up saying different things about the same currency. That one
// stays as it is: it is in production and rewriting it buys nothing.
//
// USDT IS DELIBERATELY NOT TRANSLATED. It has no Spanish name, and the
// shopkeeper reads it exactly like this in Binance; inventing one would be
// worse than the ISO code.
const CURRENCY_NAMES: Record<PriceCurrency, string> = {
  USD: "dólares",
  EUR: "euros",
  USDT: "USDT",
  COP: "pesos",
  VES: "bolívares",
};

export function currencyName(currency: PriceCurrency): string {
  // The ISO code back if something reaches here without passing through the
  // type -- a string straight from the database, say. "USD" is ugly;
  // "undefined" printed on the screen is a defect.
  return CURRENCY_NAMES[currency] ?? currency;
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


// ── El costo y su moneda ────────────────────────────────────────────────

// LA MONEDA EN LA QUE EL TENDERO ESCRIBIO EL COSTO.
//
// `"OTHER"` desde la migracion 087: decision del dueno el 2026-10-10, que
// pidio un chip «Otra» junto a bolivar, dolar, euro y USDT.
//
// LO QUE «OTHER» CUESTA, y se dice aqui porque es donde se decide: de una
// moneda que no sea una de las cuatro **no tenemos tasa**. Sin tasa no hay
// conversion, asi que un costo en «Otra» no puede calcular el precio de
// ninguna moneda. Con «Otra» el margen deja de poder trabajar y los precios se
// escriben a mano; la ficha lo dice en pantalla en vez de dejar cuatro huecos
// sin explicar.
export type CostCurrency = PriceCurrency | "OTHER";

/**
 * El precio de una moneda, calculado desde el costo y el margen.
 *
 * Es la otra mitad de `suggestedPrice`: aquella sugiere en la misma moneda del
 * costo, y esta ademas convierte. Hace falta desde que el producto puede
 * venderse en euros con el costo apuntado en dolares.
 *
 * Devuelve null cuando no se puede: sin tasa para alguna de las dos monedas, o
 * con el costo en una moneda «Otra» de la que no sabemos nada. Un null se
 * ensena como «—» y se explica; lo que no se hace nunca es inventar un numero.
 */
export function priceFromCost(
  cost: number,
  costCurrency: CostCurrency,
  marginPct: number,
  target: PriceCurrency,
  rates: BolivarRates,
): number | null {
  if (costCurrency === "OTHER") return null;
  if (!(cost > 0)) return null;
  const enDestino = priceIn(target, { amount: cost, currency: costCurrency }, rates).amount;
  if (enDestino == null) return null;
  return redondear(enDestino * (1 + marginPct / 100));
}
