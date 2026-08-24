import type { DisplayCurrency, ExchangeRateMode } from "@/lib/types";

export type MovementCurrency = "VES" | "USD" | "EUR";

// Client-safe subset of lib/exchange-rate/owner-rate.ts's OwnerRateContext —
// no supabase-js dependency, so it's fine to pass down into "use client"
// dialogs as a plain prop (loaded once server-side when the dialog's parent
// page renders, not refetched per keystroke).
export type MovementRateContext = {
  rateMode: ExchangeRateMode;
  effectiveRate: EffectiveRate;
  officialRateUsd: number;
};

export const MOVEMENT_CURRENCY_OPTIONS: { value: MovementCurrency; label: string }[] = [
  { value: "VES", label: "Bs (Bolívares)" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

// Bs per 1 unit of each foreign currency — the one rate shape every
// conversion in this feature is built from, whether it came from BCV_AUTO
// (the live fetched rate) or CUSTOM (the owner's own numbers).
export type EffectiveRate = { usd: number; eur: number };

// Converts an amount entered in any of the three currencies into Bs — the
// canonical ledger unit (see movements.amount). VES needs no conversion.
export function toBs(amount: number, currency: MovementCurrency, rate: EffectiveRate): number {
  if (currency === "VES") return amount;
  const perUnit = currency === "USD" ? rate.usd : rate.eur;
  return amount * perUnit;
}

// Inverse of toBs — converts a Bs amount back into whatever currency is
// currently selected, so a debt cap expressed in Bs (running_balance) can
// be shown/enforced in the currency the owner is actually typing in.
export function fromBs(bsAmount: number, currency: MovementCurrency, rate: EffectiveRate): number {
  if (currency === "VES") return bsAmount;
  const perUnit = currency === "USD" ? rate.usd : rate.eur;
  if (!perUnit) return bsAmount;
  return bsAmount / perUnit;
}

// Converts a Bs amount into the owner's chosen display currency, for the
// dashboard/public balance figure (the "$47.00" in "Saldo: $47.00 / Bs.
// 8.906,25"). Never used to recompute a movement's own historical Bs
// value — each movement's amount stays Bs forever.
export function bsToDisplay(bsAmount: number, displayCurrency: DisplayCurrency, rate: EffectiveRate): number {
  const perUnit = displayCurrency === "USD" ? rate.usd : rate.eur;
  if (!perUnit) return 0;
  return bsAmount / perUnit;
}
