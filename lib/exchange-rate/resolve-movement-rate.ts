import type { createClient } from "@/lib/supabase/server";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { DEFAULT_LEDGER_CURRENCY, type LedgerCurrency } from "@/lib/types";

export type MovementLedger = { currency: LedgerCurrency | null; rate: { usd: number; eur: number } | null };

// Resolves the rate snapshot for a movement. No conversion happens here —
// USD/EUR amounts are stored exactly as typed, since $50 and €20 are two
// independent debts, not one debt seen two ways. A 'CO' owner gets every
// snapshot field null and a null currency, same as today's plain COP
// behavior — that's the only case where a null currency is correct.
//
// Shared by every place that writes a movements row (manual entry, the
// photo-import confirm step): a caller passing no currency at all — either
// because the owner is CO, or because a page rendered before the owner's
// country changed to VE and never showed a currency field — must not be
// treated as "this is a plain COP movement". getOwnerRateContext re-reads
// the owner fresh from the database on every call, so a non-null result
// here means the owner is VE *right now*, and gets defaulted to USD rather
// than silently falling into the null/COP ledger.
export async function resolveMovementRateSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  currency: LedgerCurrency | null,
) {
  const rateContext = await getOwnerRateContext(supabase, ownerId);
  if (!rateContext) {
    return {
      currency: null,
      rateModeUsed: null,
      exchangeRateUsed: null,
      officialBcvRateAtTime: null,
      entryCurrency: null,
      entryAmount: null,
      rateUsdAtTime: null,
      rateEurAtTime: null,
      ledger: null as MovementLedger | null,
    };
  }

  const resolvedCurrency = currency ?? DEFAULT_LEDGER_CURRENCY;

  const officialForCurrency =
    resolvedCurrency === "USD" ? rateContext.officialRate.usd : rateContext.officialRate.eur;
  const effectiveForCurrency =
    resolvedCurrency === "USD" ? rateContext.effectiveRate.usd : rateContext.effectiveRate.eur;

  return {
    currency: resolvedCurrency,
    rateModeUsed: rateContext.rateMode,
    exchangeRateUsed: effectiveForCurrency,
    officialBcvRateAtTime: officialForCurrency,
    // entry_currency/entry_amount mirror currency/amount now that nothing
    // gets converted at write time — kept so the movement detail's existing
    // "what was typed" rows keep working unchanged.
    entryCurrency: resolvedCurrency,
    rateUsdAtTime: rateContext.effectiveRate.usd,
    rateEurAtTime: rateContext.effectiveRate.eur,
    ledger: { currency: resolvedCurrency, rate: rateContext.effectiveRate } as MovementLedger,
  };
}
