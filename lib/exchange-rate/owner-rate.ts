import type { SupabaseClient } from "@supabase/supabase-js";
import type { EffectiveRate } from "@/lib/exchange-rate/convert";
import type { DisplayCurrency, ExchangeRateMode } from "@/lib/types";

export type OwnerRateContext = {
  rateMode: ExchangeRateMode;
  // Bs per USD / Bs per EUR, whichever is actually applied to a new
  // movement right now (the owner's CUSTOM numbers, or the live BCV_AUTO
  // fetch).
  effectiveRate: EffectiveRate;
  // The live BCV_AUTO rate, always loaded regardless of mode — this is
  // what official_bcv_rate_at_time snapshots and what the CUSTOM badge
  // shows as "no es la tasa oficial BCV (X hoy)".
  officialRate: EffectiveRate;
  // Which currency the balance figure itself is shown in — Bs is always
  // the complement, never the principal, once an owner opts into this.
  displayCurrency: DisplayCurrency;
};

// Loads what's needed to convert a movement into Bs and snapshot the audit
// trail. Returns null for a country='CO' owner, or for a 'VE' owner before
// any rate has ever been fetched — callers should skip all conversion/
// currency-select/badge logic in that case, leaving existing COP behavior
// completely untouched.
export async function getOwnerRateContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ownerId: string,
): Promise<OwnerRateContext | null> {
  const [{ data: owner }, { data: settings }, { data: current }] = await Promise.all([
    supabase.from("owners").select("country").eq("id", ownerId).single(),
    supabase.from("owner_exchange_settings").select("*").eq("owner_id", ownerId).maybeSingle(),
    supabase.rpc("get_current_bcv_rate").maybeSingle(),
  ]);

  if (owner?.country !== "VE") return null;

  const officialRate = current as { usd: number; eur: number } | null;
  if (!officialRate) return null;

  const rateMode: ExchangeRateMode = settings?.rate_mode ?? "BCV_AUTO";
  const effectiveRate =
    rateMode === "CUSTOM" && settings?.custom_rate_usd && settings?.custom_rate_eur
      ? { usd: settings.custom_rate_usd as number, eur: settings.custom_rate_eur as number }
      : { usd: officialRate.usd, eur: officialRate.eur };

  return {
    rateMode,
    effectiveRate,
    officialRate: { usd: officialRate.usd, eur: officialRate.eur },
    displayCurrency: (settings?.display_currency as DisplayCurrency) ?? "USD",
  };
}
