import { createServiceClient } from "@/lib/supabase/service";
import { DolarApiProvider } from "@/lib/exchange-rate/dolar-api-provider";
import { CurrencyApiProvider } from "@/lib/exchange-rate/currency-api-provider";
import { fetchPrevista } from "@/lib/exchange-rate/fetch-prevista";
import { fetchUsdtP2p, lineaDeLog } from "@/lib/exchange-rate/usdt-p2p";
import { eurIsPlausible, lastGoodRate } from "@/lib/exchange-rate/rate-guard";
import type { OfficialRates } from "@/lib/exchange-rate/types";

// A fetch that jumps more than this from the last accepted rate is stored
// for the record but doesn't become "the" official rate on its own — see
// get_current_bcv_rate() in supabase/schema.sql, which skips needs_review
// rows entirely.
const ANOMALY_THRESHOLD = 0.15;

// How far back to look for a stored euro that makes sense. Bad rows can only pile up while an
// old deploy is live, at one every 20 minutes at most, so this covers days of them.
const RECENT_ROWS = 200;

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
  // El USDT entra aquí como TERCER extra, y en fase de medición: no se
  // guarda en ninguna columna y no lo ve ningún dueño. Solo deja rastro en el
  // log y en la respuesta del cron, que está detrás de CRON_SECRET. Ver la
  // cabecera de usdt-p2p.ts para el porqué de las tres fases.
  const [rates, prevista, usdt] = await Promise.all([
    getOfficialRatesWithFallback(),
    fetchPrevista(),
    fetchUsdtP2p(),
  ]);

  // La línea que hace medible la fase 1. Se escribe SIEMPRE, también cuando
  // sale null: "no hubo respuesta" es justo el dato que se está midiendo, y
  // un log que solo aparece los días buenos no mide nada.
  console.log(lineaDeLog(usdt, rates.usd));

  const supabase = createServiceClient();

  const { data: recent } = await supabase
    .from("bcv_exchange_rate_fetches")
    .select("usd, eur")
    .eq("needs_review", false)
    .order("fetched_at", { ascending: false })
    .limit(RECENT_ROWS);

  const last = lastGoodRate(recent ?? []);

  const usdJumped = last ? Math.abs(rates.usd - last.usd) / last.usd > ANOMALY_THRESHOLD : false;

  // THE EURO WAS NEVER CHECKED. Only the dollar was, so on 2026-11-05 a provider answering
  // `eur: 1.006` went straight in as the official rate of the day: a client could have
  // cleared €100 with Bs. 100.
  //
  // A BROKEN EURO KEEPS THE LAST OFFICIAL ONE, and the dollar stays today's. Owner's
  // decision of 2026-11-05, offered the fallback provider's figure instead: *«Usar la tasa
  // oficial»*. Marking the whole row for review would have frozen a good dollar too. What
  // this costs: the euro stops moving until the source recovers, so the error below is
  // there to be read. With no good row to keep, the row goes to review.
  //
  // NO 15% CHECK ON THE EURO, on purpose: the last stored euro may be a held one, so a jump
  // measured against it would refuse the true rate forever once the bolívar moves. See
  // rate-guard.ts.
  const eurBroken = !eurIsPlausible(rates.usd, rates.eur);
  const eur = eurBroken && last ? last.eur : rates.eur;
  if (eurBroken) console.error(`[bcv] euro descartado: ${rates.eur} de ${rates.source}. Se mantiene ${eur}.`);

  const needsReview = usdJumped || (eurBroken && !last);

  // The same source answers the prevista, so the same broken number can arrive there.
  const previstaUsable = prevista && eurIsPlausible(prevista.usd, prevista.eur) ? prevista : null;

  const { error } = await supabase.from("bcv_exchange_rate_fetches").insert({
    usd: rates.usd,
    eur,
    source: rates.source,
    rate_date: rates.rateDate,
    // Null es lo normal entre semana: no hay ninguna tasa futura publicada.
    prevista_usd: previstaUsable?.usd ?? null,
    prevista_eur: previstaUsable?.eur ?? null,
    prevista_date: previstaUsable?.fecha ?? null,
    needs_review: needsReview,
  });

  if (error) throw new Error(`No pudimos guardar la tasa: ${error.message}`);

  return {
    usd: rates.usd,
    eur,
    eur_held: eurBroken,
    source: rates.source,
    rateDate: rates.rateDate,
    prevista: previstaUsable,
    needs_review: needsReview,
    // Va en la respuesta del cron, no en la base de datos. Es diagnóstico de
    // la fase 1 y la ruta exige CRON_SECRET, así que no lo ve ningún dueño.
    // Cuando llegue la fase 2 esto deja de ser un campo suelto y pasa a ser
    // una columna; hasta entonces, borrarlo no rompe nada.
    usdt_p2p: usdt,
  };
}
