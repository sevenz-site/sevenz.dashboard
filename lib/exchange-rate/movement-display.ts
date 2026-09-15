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
