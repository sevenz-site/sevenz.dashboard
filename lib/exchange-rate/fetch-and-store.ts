import { createServiceClient } from "@/lib/supabase/service";
import { DolarApiProvider } from "@/lib/exchange-rate/dolar-api-provider";
import { CurrencyApiProvider } from "@/lib/exchange-rate/currency-api-provider";
import { fetchPrevista } from "@/lib/exchange-rate/fetch-prevista";
import type { OfficialRates } from "@/lib/exchange-rate/types";

// A fetch that jumps more than this from the last accepted rate is stored
// for the record but doesn't become "the" official rate on its own — see
// get_current_bcv_rate() in supabase/schema.sql, which skips needs_review
// rows entirely.
const ANOMALY_THRESHOLD = 0.15;

const primary = new DolarApiProvider();
const fallback = new CurrencyApiProvider();

async function getOfficialRatesWithFallback(): Promise<OfficialRates> {
  try {
    return await primary.getOfficialRates();
  } catch (primaryError) {
    try {
      return await fallback.getOfficialRates();
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Ambas fuentes de tasa fallaron. dolarapi: ${primaryMessage}. currency-api: ${fallbackMessage}`,
      );
    }
  }
}

export async function fetchAndStoreBcvRate() {
  // En paralelo a propósito: la tasa prevista es un extra y no puede alargar la
  // consulta de la que sí rige. refreshBcvRateIfStale corre esto en la ruta de
  // escritura con un límite de 2,5 s, así que encadenarlas sería sumar tiempo a
  // un dueño que está esperando a que se guarde su fiado.
  const [rates, prevista] = await Promise.all([
    getOfficialRatesWithFallback(),
    fetchPrevista(),
  ]);
  const supabase = createServiceClient();

  const { data: last } = await supabase
    .from("bcv_exchange_rate_fetches")
    .select("usd")
    .eq("needs_review", false)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const needsReview = last ? Math.abs(rates.usd - last.usd) / last.usd > ANOMALY_THRESHOLD : false;

  const { error } = await supabase.from("bcv_exchange_rate_fetches").insert({
    usd: rates.usd,
    eur: rates.eur,
    source: rates.source,
    rate_date: rates.rateDate,
    // Null es lo normal entre semana: no hay ninguna tasa futura publicada.
    prevista_usd: prevista?.usd ?? null,
    prevista_eur: prevista?.eur ?? null,
    prevista_date: prevista?.fecha ?? null,
    needs_review: needsReview,
  });

  if (error) throw new Error(`No pudimos guardar la tasa: ${error.message}`);

  return {
    usd: rates.usd,
    eur: rates.eur,
    source: rates.source,
    rateDate: rates.rateDate,
    prevista,
    needs_review: needsReview,
  };
}
