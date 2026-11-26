// HOW THE MONEY ARRIVED: the payment method of a sale payment or an abono.
//
// Owner's request of 2026-11-17: a «Método de pago» field in the payment of an abono, a cash
// sale and a fiado, and a chart in Reportes answering «¿Cuáles son los métodos de pago que
// generan mayor ingreso?». ONE list, here, read by the three forms, the two server actions, the
// detail screens of both faces and the chart, so none of them can spell a method its own way.
//
// THE VALUES ARE ENGLISH, the labels Spanish. A value is stored in `sale_payments.payment_method`
// and `movements.payment_method` (migration 214), which outlive the code, and the check
// constraints (214, now 220) list exactly these. A new method is a migration first, then a line
// here: with the line and no migration, the database refuses the payment.
//
// THE LIST DEPENDS ON THE BOOK, not on a country lookup: a payment in the USD or EUR book is a
// Venezuelan business, one in the COP book (spelled NULL in `movements`) a Colombian one. The
// owner gave each its list on 2026-11-17. «Punto» and «Punto de venta» are the same thing, a card
// terminal, so they share a value and the label follows the country.

export const PAYMENT_METHODS = [
  "mobile_payment",
  "cash",
  "card",
  // Migration 220, 2026-11-25. Venezuela only.
  "biopago",
  "bank_transfer",
  "binance_usdt",
  "zelle",
  "paypal",
  "zinli",
  "nequi",
  "qr",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// In the order the owner wrote them. The first one is not the default: see `defaultMethod`.
const VENEZUELA: { value: PaymentMethod; label: string }[] = [
  { value: "mobile_payment", label: "Pago móvil" },
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Punto" },
  // Owner's request of 2026-11-25. Beside «Punto»: both are a terminal on the counter.
  { value: "biopago", label: "Biopago" },
  { value: "bank_transfer", label: "Transferencia" },
  { value: "binance_usdt", label: "Binance / USDT" },
  { value: "zelle", label: "Zelle" },
  { value: "paypal", label: "Paypal" },
  { value: "zinli", label: "Zinli" },
];

const COLOMBIA: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "nequi", label: "Nequi" },
  { value: "qr", label: "QR" },
  { value: "card", label: "Punto de venta" },
  { value: "bank_transfer", label: "Transferencia" },
];

/** A Colombian book: `sale_payments` spells it 'COP' and `movements` NULL. */
function esColombia(bookCurrency: string | null | undefined): boolean {
  return bookCurrency == null || bookCurrency === "COP";
}

/** The methods offered for a payment in this book, in the owner's order. */
export function methodsForBook(bookCurrency: string | null | undefined) {
  return esColombia(bookCurrency) ? COLOMBIA : VENEZUELA;
}

/**
 * The method the field opens with. Owner's decision of 2026-11-17: «si teclea bolívares = por
 * defecto pago móvil. Si teclea dólares o euros = por defecto efectivo. Pero en euro o dólares
 * puede seleccionar pago móvil». A Colombian business opens on «Efectivo».
 *
 * WHY THE DEFAULT FOLLOWS THE CURRENCY TYPED: «Pago móvil» everywhere would file every dollar
 * paid in cash and never corrected as a Pago móvil, and the Reportes chart would say so with
 * nothing to warn anyone.
 */
export function defaultMethod(
  bookCurrency: string | null | undefined,
  entryCurrency: string | null | undefined,
): PaymentMethod {
  if (esColombia(bookCurrency)) return "cash";
  return entryCurrency === "VES" ? "mobile_payment" : "cash";
}

/**
 * The method an ABONO opens with: «Pago móvil», whatever currency is typed. Owner's decision of
 * 2026-11-25: «En el registro de abono colocar por defecto el método de pago "Pago móvil"».
 *
 * IT DISPLACES, FOR ABONOS ONLY, HIS RULE OF 2026-11-17 ABOVE, and he chose it with that rule and
 * its cost in front of him: a dollar abono paid in cash and never corrected is filed as a Pago
 * móvil, and the Reportes chart says so with nothing to warn anyone. The sale and the return keep
 * the rule of 2026-11-17.
 *
 * A Colombian business still opens on «Efectivo»: Pago móvil is not in its list, and the server
 * would refuse it.
 */
export function defaultAbonoMethod(bookCurrency: string | null | undefined): PaymentMethod {
  return esColombia(bookCurrency) ? "cash" : "mobile_payment";
}

/** Whether `value` is a method this book accepts. The server's check, before the database's. */
export function isMethodForBook(value: unknown, bookCurrency: string | null | undefined): value is PaymentMethod {
  return typeof value === "string" && methodsForBook(bookCurrency).some((m) => m.value === value);
}

/**
 * The label of a stored method, or null for a payment recorded before 2026-11-17 (or by a path
 * that does not ask, such as the libreta import). The label follows the book's country, and a
 * value the other country's list carries still gets its name rather than nothing.
 */
export function methodLabel(value: string | null | undefined, bookCurrency?: string | null): string | null {
  if (!value) return null;
  const propia = methodsForBook(bookCurrency).find((m) => m.value === value);
  if (propia) return propia.label;
  return [...VENEZUELA, ...COLOMBIA].find((m) => m.value === value)?.label ?? null;
}

/** The label the Reportes chart gives the payments that carry no method. */
export const SIN_METODO = "Sin registrar";
