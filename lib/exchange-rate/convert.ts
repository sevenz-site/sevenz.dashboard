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
  displayCurrency: DisplayCurrency;
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

// ── The ledger is USD-indexed ───────────────────────────────────────────
// For a country='VE' owner, movements.amount and running_balance hold USD,
// not Bs. The debt itself is denominated in dollars — a client who owes $50
// still owes $50 tomorrow, while the bolívar figure floats with the rate.
// Bs is therefore always derived at read time from the *current* rate,
// never stored as the balance.
//
// USD is the anchor even when the owner displays EUR: one summable unit
// means a running balance always adds up and switching display currency
// can never corrupt existing debt.

// Converts an amount typed in any of the three currencies into the USD the
// ledger stores.
export function toUsd(amount: number, currency: MovementCurrency, rate: EffectiveRate): number {
  if (currency === "USD") return amount;
  if (currency === "VES") return rate.usd ? amount / rate.usd : 0;
  return rate.usd ? (amount * rate.eur) / rate.usd : 0;
}

// Inverse of toUsd — used to express a USD debt cap in whichever currency
// the owner is currently typing in.
export function fromUsd(usdAmount: number, currency: MovementCurrency, rate: EffectiveRate): number {
  if (currency === "USD") return usdAmount;
  if (currency === "VES") return usdAmount * rate.usd;
  return rate.eur ? (usdAmount * rate.usd) / rate.eur : 0;
}

// The stored USD amount shown in the owner's chosen display currency.
export function usdToDisplay(
  usdAmount: number,
  displayCurrency: DisplayCurrency,
  rate: EffectiveRate,
): number {
  if (displayCurrency === "USD") return usdAmount;
  return rate.eur ? (usdAmount * rate.usd) / rate.eur : 0;
}

// Today's bolívar value of a stored USD amount. This is the figure that
// moves day to day as the rate moves — the whole point of indexing.
export function usdToBs(usdAmount: number, rate: EffectiveRate): number {
  return usdAmount * rate.usd;
}

// Standalone converter behind the rate strip's calculator — pure "what is X
// worth in the other two currencies" arithmetic, unrelated to how the ledger
// stores anything.
export function convertToAllCurrencies(
  amount: number,
  fromCurrency: MovementCurrency,
  rate: EffectiveRate,
): { ves: number; usd: number; eur: number } {
  const ves =
    fromCurrency === "VES"
      ? amount
      : amount * (fromCurrency === "USD" ? rate.usd : rate.eur);
  return {
    ves,
    usd: rate.usd ? ves / rate.usd : 0,
    eur: rate.eur ? ves / rate.eur : 0,
  };
}
