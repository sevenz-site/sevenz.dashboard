import type { EffectiveRate } from "@/lib/exchange-rate/convert";
import type { DisplayCurrency } from "@/lib/types";

// Present (non-null) only for a country='VE' owner. null means "this ledger
// is plain COP" — every surface then formats exactly as it always has.
export type LedgerDisplay = {
  displayCurrency: DisplayCurrency;
  // The owner's current effective rate, used only for movements written
  // before per-movement rate snapshots existed.
  fallbackRate: EffectiveRate;
};

// The per-movement rate snapshot (see supabase/023_movement_rate_snapshot.sql).
export type MovementRateSnapshot = {
  rate_usd_at_time: number | null;
  rate_eur_at_time: number | null;
};

// The rate to convert this movement's Bs figures into the display currency:
// the one in effect when the movement happened, so a historical figure stays
// put instead of drifting as rates move. Pre-snapshot movements fall back to
// the owner's current rate — the best available answer for those.
export function rateForDisplayAt(
  movement: MovementRateSnapshot,
  ledger: LedgerDisplay,
): number {
  const stored =
    ledger.displayCurrency === "USD" ? movement.rate_usd_at_time : movement.rate_eur_at_time;
  const fallback =
    ledger.displayCurrency === "USD" ? ledger.fallbackRate.usd : ledger.fallbackRate.eur;
  return stored ?? fallback;
}

export function bsToDisplayAt(
  bsAmount: number,
  movement: MovementRateSnapshot,
  ledger: LedgerDisplay,
): number {
  const rate = rateForDisplayAt(movement, ledger);
  return rate ? bsAmount / rate : 0;
}
