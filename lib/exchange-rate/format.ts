// Bs is formatted manually (not via Intl's "VES" currency code) because ICU
// data renders the VES symbol inconsistently across environments (Bs.S vs
// VES vs Bs.) — the design doc's examples always show the literal "Bs. "
// prefix, so that's what every surface should match exactly.
const bsNumberFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBs(amount: number): string {
  return `Bs. ${bsNumberFormatter.format(amount)}`;
}

// Same "es-VE", 2-decimal formatting as formatBs, without the "Bs. " prefix —
// for surfaces (like an amount input) that show the number on its own.
export function formatBsAmount(amount: number): string {
  return bsNumberFormatter.format(amount);
}

// ===========================================================================
// DÓLARES Y EUROS, CON EL PUNTO DE MILES — «$1.234.567,89»
//
// Decisión del dueño el 2026-10-24, para toda la app: *«ese formato de miles
// 1.000 será el estándar para toda el app»*. Era `en-US` —«$1,234,567.89»— y
// quedaba como la ÚNICA excepción del producto: el peso ya se formateaba en
// `es-CO` y el bolívar en `es-VE`, los dos con punto de miles y coma decimal
// desde siempre. Así que esto no cambia una convención: termina de aplicarla.
//
// SE HACE A MANO Y NO CON `style: "currency"`, y no es por capricho: NINGÚN
// locale da «$1.234.567,89» con el símbolo pegado delante. Medido el
// 2026-10-24 sobre el ICU de este Node:
//
//   es-VE → "USD 1.234.567,89"      es-CO → "US$ 1.234.567,89"
//   de-DE → "1.234.567,89 $"        es-ES → "1.234.567,89 US$"
//
// Todos cambian el símbolo, lo mueven al final, o las dos cosas. Con un
// formateador de número y el símbolo literal delante, lo ÚNICO que cambia
// respecto a lo que había son los separadores — el símbolo y su posición se
// quedan donde estaban. Es la misma razón, y el mismo patrón, que `formatBs`
// lleva documentados aquí arriba desde el primer día.
const displayNumberFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DISPLAY_SYMBOL: Record<"USD" | "EUR", string> = { USD: "$", EUR: "€" };

export function formatDisplayCurrency(amount: number, currency: "USD" | "EUR"): string {
  // EL SIGNO VA DELANTE DEL SÍMBOLO: «-$1.234,56», no «$-1.234,56». Lo que
  // `style: "currency"` hacía solo, aquí hay que escribirlo — y sin esto el
  // menos quedaba entre el símbolo y la cifra, que se lee como un error de la
  // app. Hoy los tres sitios que pueden enseñar un saldo a favor ya pasan un
  // `Math.abs` y un chip «A favor» (regla de CLAUDE.md del 2026-10-23), así
  // que esto es la red de debajo, no el camino normal.
  const negativo = amount < 0;
  return `${negativo ? "-" : ""}${DISPLAY_SYMBOL[currency]}${displayNumberFormatter.format(
    Math.abs(amount),
  )}`;
}

// "$1 = Bs. 779,95" / "€1 = Bs. 911,22" — the rate always shown as a full
// equivalence, never a bare number, so it's clear which currency it converts.
export function formatRateEquivalence(currency: "USD" | "EUR", rate: number): string {
  return `${currency === "USD" ? "$" : "€"}1 = ${formatBs(rate)}`;
}
