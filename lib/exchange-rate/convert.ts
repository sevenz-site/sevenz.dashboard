import type { ExchangeRateMode, LedgerCurrency } from "@/lib/types";

// The calculator in the rate strip converts freely between all three — it's
// a lookup tool, not movement entry, so bolívares belong there.
export type MovementCurrency = "VES" | "USD" | "EUR";

export const MOVEMENT_CURRENCY_OPTIONS: { value: MovementCurrency; label: string }[] = [
  { value: "VES", label: "Bs (Bolívares)" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
];

// Bs per 1 unit of each foreign currency — the one rate shape every
// conversion in this feature is built from, whether it came from BCV_AUTO
// (the live fetched rate) or CUSTOM (the owner's own numbers).
export type EffectiveRate = { usd: number; eur: number };

// Client-safe subset of lib/exchange-rate/owner-rate.ts's OwnerRateContext —
// no supabase-js dependency, so it's fine to pass down into "use client"
// dialogs as a plain prop (loaded once server-side when the dialog's parent
// page renders, not refetched per keystroke).
export type MovementRateContext = {
  rateMode: ExchangeRateMode;
  effectiveRate: EffectiveRate;
  officialRateUsd: number;
};

// ── Per-currency ledgers ────────────────────────────────────────────────
// A VE owner's debt is denominated in USD or EUR and stays there: amounts
// are never converted between currencies, because $50 and €20 are two
// separate debts, not one debt seen two ways. The only conversion that ever
// happens is to bolívares for display, at today's rate.

export function rateFor(currency: LedgerCurrency, rate: EffectiveRate): number {
  return currency === "USD" ? rate.usd : rate.eur;
}

// Today's bolívar value of an amount in its own currency. This moves day to
// day as the rate moves — the figure the client actually pays.
export function toBs(amount: number, currency: LedgerCurrency, rate: EffectiveRate): number {
  return amount * rateFor(currency, rate);
}

// Status, mora and the credit score stay one combined judgement per client,
// so the two ledgers have to be expressed in a single unit to be weighed
// together. USD is that unit; EUR crosses through bolívares.
export function toCombinedUsd(
  amount: number,
  currency: LedgerCurrency | null,
  rate: EffectiveRate,
): number {
  if (currency === "EUR") return rate.usd ? (amount * rate.eur) / rate.usd : 0;
  return amount;
}

export function combinedBalanceUsd(
  balanceUsd: number,
  balanceEur: number,
  rate: EffectiveRate,
): number {
  return balanceUsd + toCombinedUsd(balanceEur, "EUR", rate);
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
    fromCurrency === "VES" ? amount : amount * (fromCurrency === "USD" ? rate.usd : rate.eur);
  return {
    ves,
    usd: rate.usd ? ves / rate.usd : 0,
    eur: rate.eur ? ves / rate.eur : 0,
  };
}
