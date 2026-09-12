import type { SupabaseClient } from "@supabase/supabase-js";
import type { EffectiveRate } from "@/lib/exchange-rate/convert";
import type { ExchangeRateMode } from "@/lib/types";
import { refreshBcvRateIfStale } from "@/lib/exchange-rate/ensure-fresh";
import { rateStatusFor, todayInCaracas, type RateStatus } from "@/lib/exchange-rate/rate-status";

export type { RateStatus };

export type OwnerRateContext = {
  rateMode: ExchangeRateMode;
  // When we last fetched. Used only to decide whether to refetch — never to
  // tell an owner which rate they are looking at, which is what rateDate is
  // for. The two differ every weekend.
  fetchedAt: string;
  // The day the rate on screen belongs to, "YYYY-MM-DD". Null for a row stored
  // before migration 046, or one that came from the currency-api fallback.
  rateDate: string | null;
  rateStatus: RateStatus;
  // Bs per USD / Bs per EUR, whichever is actually applied to a new
  // movement right now (the owner's CUSTOM numbers, or the live BCV_AUTO
  // fetch).
  effectiveRate: EffectiveRate;
  // The live BCV_AUTO rate, always loaded regardless of mode — this is
  // what official_bcv_rate_at_time snapshots and what the CUSTOM badge
  // shows as "no es la tasa oficial BCV (X hoy)".
  officialRate: EffectiveRate;
};

// Por qué no hay contexto de tasa. Son dos razones distintas que durante
// meses se devolvieron como el mismo `null`:
//
//   "co"           el dueño es colombiano y no hay moneda que elegir.
//                  currency = null es la respuesta correcta, no una ausencia.
//   "ve_sin_tasa"  el dueño es venezolano, pero no hay ninguna tasa guardada
//                  todavía o la consulta no la devolvió.
//
// Confundirlas es un fallo de dinero: quien escribe un movimiento leía el
// `null` como "es CO" y archivaba el fiado de un venezolano en el libro COP,
// en silencio y de forma permanente. Auditado el 2026-09-11 en dev y en
// producción: cero filas afectadas, así que la trampa estaba armada y no
// había disparado todavía.
export type OwnerRateContextResult =
  | { kind: "co" }
  | { kind: "ve"; context: OwnerRateContext }
  | { kind: "ve_sin_tasa" }
  // No se pudo leer el país. Es su propio caso y no se pliega a "co", porque
  // plegarlo ahí es exactamente el fallo que esta función vino a arreglar: un
  // `data` nulo por un error de red haría que un dueño venezolano escribiera
  // en el libro colombiano. No saber no es lo mismo que saber que es CO.
  | { kind: "pais_desconocido" };

// Lo mismo que getOwnerRateContext, pero diciendo por qué. Lo usa la ruta de
// escritura, que necesita distinguir; las pantallas se quedan con el envoltorio
// de abajo, al que le basta con "hay tasa o no".
export async function getOwnerRateContextResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ownerId: string,
): Promise<OwnerRateContextResult> {
  const { data: owner, error } = await supabase
    .from("owners")
    .select("country")
    .eq("id", ownerId)
    .single();

  if (error || !owner?.country) return { kind: "pais_desconocido" };
  if (owner.country !== "VE") return { kind: "co" };

  const context = await getOwnerRateContext(supabase, ownerId);
  return context ? { kind: "ve", context } : { kind: "ve_sin_tasa" };
}

// Loads what's needed to convert a movement into Bs and snapshot the audit
// trail. Returns null for a country='CO' owner, or for a 'VE' owner before
// any rate has ever been fetched — callers should skip all conversion/
// currency-select/badge logic in that case, leaving existing COP behavior
// completely untouched.
//
// Las seis pantallas que lo llaman solo quieren saber si pintan el selector de
// moneda y la insignia de tasa, así que para ellas los dos casos sin tasa se
// comportan igual y la firma no cambia. Quien escribe dinero usa
// getOwnerRateContextResult.
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

  const stored = current as {
    usd: number;
    eur: number;
    fetched_at: string;
    rate_date: string | null;
  } | null;
  if (!stored) return null;

  // The Vercel cron fires once a day (Hobby plan), which left the dashboard
  // showing yesterday's rate while sevenz.site — fetching from the visitor's
  // own browser — was current. Refreshing here instead of on a schedule keeps
  // both the number on screen and the rate stamped onto a new fiado on the
  // same value, which is the whole point: an owner must never be shown one
  // rate and have another one recorded.
  const refresh = await refreshBcvRateIfStale(stored.fetched_at);
  const officialRate =
    refresh.status === "refreshed"
      ? { usd: refresh.usd, eur: refresh.eur, rateDate: refresh.rateDate }
      : { usd: stored.usd, eur: stored.eur, rateDate: stored.rate_date };

  // "fresh" counts as confirmed: it means the stored row was fetched inside
  // MAX_AGE_MS, so the provider agreed with us minutes ago.
  const confirmed = refresh.status !== "unconfirmed";
  const rateStatus = rateStatusFor(officialRate.rateDate, todayInCaracas(), confirmed);

  const rateMode: ExchangeRateMode = settings?.rate_mode ?? "BCV_AUTO";
  const effectiveRate =
    rateMode === "CUSTOM" && settings?.custom_rate_usd && settings?.custom_rate_eur
      ? { usd: settings.custom_rate_usd as number, eur: settings.custom_rate_eur as number }
      : { usd: officialRate.usd, eur: officialRate.eur };

  return {
    rateMode,
    effectiveRate,
    officialRate: { usd: officialRate.usd, eur: officialRate.eur },
    // If the refresh produced a rate, that fetch just happened, so the stored
    // row's timestamp is already out of date by one refresh.
    fetchedAt: refresh.status === "refreshed" ? new Date().toISOString() : stored.fetched_at,
    // Comes from whichever rate is actually on screen — the refreshed one when
    // there is one, otherwise the stored row's.
    rateDate: officialRate.rateDate,
    rateStatus,
  };
}
