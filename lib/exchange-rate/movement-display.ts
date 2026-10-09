import { toBs, type EffectiveRate } from "@/lib/exchange-rate/convert";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import type { LedgerCurrency } from "@/lib/types";

// Present (non-null) only for a country='VE' owner. null means "this ledger
// is plain COP" — every surface then formats exactly as it always has.
// There's no display-currency choice any more: a VE owner sees each debt in
// the currency it was actually incurred in.
export type LedgerDisplay = {
  // The owner's current effective rate. Always today's, since a debt's
  // bolívar value is recomputed on every read rather than frozen.
  rate: EffectiveRate;
};

// The one place a stored amount becomes display strings, so the dashboard,
// the client table, both movement lists, the detail dialog and the public
// client screen can't drift apart. `secondary` is the floating Bs figure;
// null for a COP owner, who has no second line at all.
//
// CUIDADO con llamarlo sin `ledger`. El fallback de abajo es formatCurrency,
// que son PESOS COLOMBIANOS: pasar ledger=null con currency='EUR' devuelve
// "$ 45,00" para 45 euros, sin avisar de nada. Es un atajo razonable mientras
// null signifique "negocio colombiano", que es para lo que se escribio, pero
// deja de serlo en cualquier pantalla que simplemente no tenga a mano la tasa
// de hoy — y eso es exactamente lo que le paso a la ficha de un movimiento
// eliminado. Si lo unico que hace falta es formatear en la moneda del
// movimiento, sin equivalente en bolivares, usa formatDisplayCurrency
// directamente.
export function formatLedgerAmount(
  amount: number,
  currency: LedgerCurrency | null,
  ledger: LedgerDisplay | null,
): { primary: string; secondary: string | null } {
  if (!ledger || !currency) {
    return { primary: formatCurrency(amount), secondary: null };
  }
  return {
    primary: formatDisplayCurrency(amount, currency),
    secondary: formatBs(toBs(amount, currency, ledger.rate)),
  };
}

// A one-line summary for the WhatsApp reminder message — "$50.00 y €20.00"
// when a VE client owes in both currencies, just the one figure when they
// owe in only one, and the plain COP figure for a 'CO' client.
export function formatBalanceSummary(
  balanceCop: number,
  balanceUsd: number,
  balanceEur: number,
  ledger: LedgerDisplay | null,
): string {
  if (!ledger) return formatCurrency(balanceCop);

  const parts: string[] = [];
  if (balanceUsd > 0) parts.push(formatDisplayCurrency(balanceUsd, "USD"));
  if (balanceEur > 0) parts.push(formatDisplayCurrency(balanceEur, "EUR"));
  if (parts.length === 0) return formatDisplayCurrency(0, "USD");
  return parts.join(" y ");
}

// CÓMO SE LLAMA CADA MONEDA EN LA TARJETA DE CAPITAL, en un solo sitio.
//
// "USD" en siglas y "Euro" en palabra, que es lo que pidió el dueño y lo que
// ya decía el rótulo grande. Que viva aquí y no en `balance-card.tsx` no es
// organización: ese archivo es `"use client"`, y el rótulo grande lo arma la
// página, que es un Server Component. Llamarlo desde allí revienta en
// ejecución con "Attempted to call ledgerLabel() from the server but
// ledgerLabel is on the client" — pasó el 2026-10-08 al escribirlo.
//
// Y tiene que ser uno solo: la línea pequeña y el rótulo grande estuvieron un
// rato diciendo "en Euro" arriba y "en EUR" abajo, dos convenciones pegadas
// en la misma tarjeta, porque cada uno construía su texto por su cuenta.
export const LEDGER_NAME: Record<LedgerCurrency, string> = {
  USD: "USD",
  EUR: "Euro",
};

export function ledgerLabel(currency: LedgerCurrency | null): string {
  return currency ? `Capital por cobrar en ${LEDGER_NAME[currency]}` : "Capital por cobrar";
}
