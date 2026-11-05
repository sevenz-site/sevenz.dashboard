import { createServiceClient } from "@/lib/supabase/service";
import { DolarApiProvider } from "@/lib/exchange-rate/dolar-api-provider";
import { CurrencyApiProvider } from "@/lib/exchange-rate/currency-api-provider";
import { fetchPrevista } from "@/lib/exchange-rate/fetch-prevista";
import { readDolarVzla } from "@/lib/exchange-rate/dolar-vzla-provider";
import { readBcvPage } from "@/lib/exchange-rate/bcv-page-provider";
import { fetchUsdtP2p, lineaDeLog } from "@/lib/exchange-rate/usdt-p2p";
import { lastGoodRate } from "@/lib/exchange-rate/rate-guard";
import { describeSources, resolveOfficialRates } from "@/lib/exchange-rate/resolve-rates";
import { todayInCaracas } from "@/lib/exchange-rate/rate-status";
import type { DatedRate } from "@/lib/exchange-rate/dated-rate";

// How far back to look for a stored rate that makes sense. Bad rows can only pile up while an
// old deploy is live, at one every 20 minutes at most, so this covers days of them.
const RECENT_ROWS = 200;

const dolarApi = new DolarApiProvider();
// Not a BCV mirror: an aggregator whose VES figure merely tracks the official one. Owner's
// decision of 2026-11-05, *«Usar la tasa oficial»*: it never becomes the rate a fiado is
// stamped with. It only keeps the strip alive when all three mirrors fail, and its row goes to
// review, which get_current_bcv_rate() skips.
const aggregator = new CurrencyApiProvider();

async function readDolarApi(today: string): Promise<DatedRate[]> {
  const rates = await dolarApi.getOfficialRates();
  return [{ date: rates.rateDate ?? today, usd: rates.usd, eur: rates.eur, source: "dolarapi" }];
}

export type SourceOutcome = { source: string; ok: boolean; detail: string };

function collect(
  name: string,
  result: PromiseSettledResult<DatedRate[] | DatedRate | null>,
  readings: DatedRate[],
  outcomes: SourceOutcome[],
) {
  if (result.status === "fulfilled") {
    const list = Array.isArray(result.value) ? result.value : result.value ? [result.value] : [];
    readings.push(...list);
    outcomes.push({ source: name, ok: true, detail: list.map((r) => `${r.date} ${r.usd}/${r.eur}`).join(", ") || "nada publicado" });
  } else {
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    outcomes.push({ source: name, ok: false, detail: reason });
  }
}

export async function fetchAndStoreBcvRate() {
  const today = todayInCaracas();

  // All in parallel, on purpose: refreshBcvRateIfStale runs this on the write path with a
  // 2,5 s deadline, so chaining sources would add their latencies to an owner waiting for a
  // fiado to save. Each source has its own 8 s timeout and its own failure; one down never
  // takes the others with it.
  // THREE MIRRORS OF THE BCV since 2026-11-05 (DolarApi, DolarVZLA, the BCV's own page) and
  // the resolver decides per currency; see resolve-rates.ts for the table. The USDT is a
  // separate extra, still in its measuring phase: see the header of usdt-p2p.ts.
  const [fromDolarApi, previstaFromDolarApi, fromDolarVzla, fromBcv, usdt] = await Promise.allSettled([
    readDolarApi(today),
    fetchPrevista(),
    readDolarVzla(),
    readBcvPage(),
    fetchUsdtP2p(),
  ]);

  const readings: DatedRate[] = [];
  const sources: SourceOutcome[] = [];
  collect("dolarapi", fromDolarApi, readings, sources);
  collect("dolarapi-prevista", previstaFromDolarApi, readings, sources);
  collect("dolarvzla", fromDolarVzla, readings, sources);
  collect("bcv", fromBcv, readings, sources);
  // One line per source, always, including the good days: the daily diagnosis and a human
  // reading Vercel's log need to see a source go quiet, and a log that only speaks on bad days
  // cannot show that.
  for (const s of sources) console.log(`[tasas] ${s.source}: ${s.ok ? "ok" : "FALLA"} ${s.detail}`);

  const supabase = createServiceClient();

  const { data: recent } = await supabase
    .from("bcv_exchange_rate_fetches")
    .select("usd, eur")
    .eq("needs_review", false)
    .order("fetched_at", { ascending: false })
    .limit(RECENT_ROWS);

  // The newest stored row whose numbers make sense, not the newest row: an older deploy may
  // have stored a broken one. See lastGoodRate.
  const last = lastGoodRate(recent ?? []);

  let resolution = resolveOfficialRates(readings, today, last);
  let aggregatorUsed = false;
  if (resolution.date === null) {
    // No mirror gave a dated reading at all. The aggregator keeps the strip alive; its row is
    // reviewed so it never stamps anything. If it fails too, no row is written, as before.
    try {
      const rates = await aggregator.getOfficialRates();
      readings.push({ date: today, usd: rates.usd, eur: rates.eur, source: "currency-api" });
      sources.push({ source: "currency-api", ok: true, detail: `${rates.usd}/${rates.eur}` });
      aggregatorUsed = true;
      resolution = resolveOfficialRates(readings, today, last);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      sources.push({ source: "currency-api", ok: false, detail: reason });
      throw new Error(`Ninguna fuente de tasa respondió. ${sources.map((s) => `${s.source}: ${s.detail}`).join(". ")}`);
    }
  }

  const usdtValue = usdt.status === "fulfilled" ? usdt.value : null;
  // The line that makes the USDT's phase 1 measurable. Written ALWAYS, also when it is null:
  // "no answer" is exactly the datum being measured.
  console.log(lineaDeLog(usdtValue, resolution.usd.value ?? last?.usd ?? 0));
  console.log(`[tasas] ${resolution.usd.reason} · ${resolution.eur.reason}`);

  // A HELD VALUE IS YESTERDAY'S NUMBER WITH TODAY'S FACE. It is right to hold it (owner's
  // decision of 2026-11-05: keep the last official one, never the aggregator's) and wrong to
  // hold it in silence: this line is what PL-25 turns into a message to the owner.
  if (resolution.usd.held || resolution.eur.held) {
    console.error(`[tasas] TASA RETENIDA (${describeSources(resolution)}): ${resolution.usd.reason} · ${resolution.eur.reason}`);
  }

  // A currency with nothing believable and nothing to hold is stored raw and reviewed, as the
  // single-source code did: the row documents what arrived, and get_current_bcv_rate() skips
  // it, so it never reaches a fiado.
  const rawOfDay = readings.find((r) => r.date === resolution.date);
  const usd = resolution.usd.value ?? rawOfDay?.usd;
  const eur = resolution.eur.value ?? rawOfDay?.eur;
  if (usd === undefined || eur === undefined) throw new Error("Ninguna fuente dio una tasa utilizable.");
  const needsReview = resolution.needsReview || aggregatorUsed;
  const prevista = resolution.prevista;
  const source = aggregatorUsed ? "currency-api" : describeSources(resolution);

  const { error } = await supabase.from("bcv_exchange_rate_fetches").insert({
    usd,
    eur,
    source,
    rate_date: resolution.date,
    // Null is the norm on a weekday: no future rate is published.
    prevista_usd: prevista?.usd ?? null,
    prevista_eur: prevista?.eur ?? null,
    prevista_date: prevista?.date ?? null,
    needs_review: needsReview,
  });

  if (error) throw new Error(`No pudimos guardar la tasa: ${error.message}`);

  return {
    usd,
    eur,
    usd_held: resolution.usd.held,
    eur_held: resolution.eur.held,
    witnesses: { usd: resolution.usd.witnesses, eur: resolution.eur.witnesses },
    source,
    rateDate: resolution.date,
    prevista: prevista ? { fecha: prevista.date, usd: prevista.usd, eur: prevista.eur, source: prevista.source } : null,
    needs_review: needsReview,
    // Diagnosis for the cron's response, which sits behind CRON_SECRET, and for
    // qa:diagnostico-tasas. Never shown to an owner.
    sources,
    reasons: [resolution.usd.reason, resolution.eur.reason],
    usdt: usdtValue,
  };
}
