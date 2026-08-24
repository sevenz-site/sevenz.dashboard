import { usdToBs, usdToDisplay, type EffectiveRate } from "@/lib/exchange-rate/convert";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import type { DisplayCurrency } from "@/lib/types";

// Present (non-null) only for a country='VE' owner. null means "this ledger
// is plain COP" — every surface then formats exactly as it always has.
export type LedgerDisplay = {
  displayCurrency: DisplayCurrency;
  // The owner's *current* effective rate. Always today's: the debt is
  // USD-indexed, so its bolívar value is recomputed every time it's read
  // rather than frozen at the moment of the movement.
  rate: EffectiveRate;
};

// The one place a stored ledger amount becomes display strings, so the
// dashboard, the client table, the movement list, the detail dialog and the
// public client screen can't drift apart. `secondary` is the floating Bs
// figure; null for a COP owner, who has no second line at all.
export function formatLedgerAmount(
  amount: number,
  ledger: LedgerDisplay | null,
): { primary: string; secondary: string | null } {
  if (!ledger) return { primary: formatCurrency(amount), secondary: null };
  return {
    primary: formatDisplayCurrency(
      usdToDisplay(amount, ledger.displayCurrency, ledger.rate),
      ledger.displayCurrency,
    ),
    secondary: formatBs(usdToBs(amount, ledger.rate)),
  };
}
