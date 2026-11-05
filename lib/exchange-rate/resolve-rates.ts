import { eurIsPlausible, usdIsPlausible } from "@/lib/exchange-rate/rate-guard";
import { DATE_RE, type DatedRate, type RateSource } from "@/lib/exchange-rate/dated-rate";

// THREE SOURCES, ONE RATE. Pure: no network, no database, so qa/fuentes-tasa.mjs can run every
// branch with the real numbers of the day each branch was written for.
//
// WHY THREE. DolarApi was the only source until 2026-11-05, when it started answering 1,006
// for a euro of 1.006,03. Nothing failed: the number was simply wrong, and a single source
// cannot be wrong in a way anyone can detect. With two sources a disagreement is visible but
// undecidable. With three, two can outvote one, and the BCV's own page is the natural tie
// breaker because it is what the other two copy. Owner's decision of 2026-11-05: *«Vamos con
// las tres opciones: DolarApi, DolarVZLA y página del BCV»*.
//
// PER CURRENCY, NOT PER SOURCE. DolarApi is broken in the euro and right in the dollar, and
// when the dollar crosses Bs. 1.000 it may be the other way round. So each currency is judged
// on its own, and a source can be a witness for one and excluded for the other.
//
// THE TABLE, as agreed with the owner on 2026-11-05:
//   two or more agree          -> that value, those witnesses
//   they disagree, BCV present -> the BCV's value (the arbiter)
//   they disagree, no BCV      -> keep the last good value
//   one witness                -> accept if within 5% of the last good value, else keep it
//   nobody believable          -> keep the last good value
// Keeping the last good value is called "held" everywhere, and a held value has to be
// reported (PL-25): it is yesterday's number with today's face.

export const SINGLE_WITNESS_TOLERANCE = 0.05;
// Sources copy the BCV to eight decimals; DolarApi rounds the dollar to four. Anything past
// this is not rounding, it is a different number.
export const AGREEMENT_TOLERANCE = 0.001;
const ARBITER: RateSource = "bcv";
// For the prevista there is nothing stored to hold, so a lone or disputed reading is taken in
// this order: the BCV publishes it, DolarVZLA copies it with no transformation, DolarApi is
// the one that broke.
const PREFERENCE: RateSource[] = ["bcv", "dolarvzla", "dolarapi", "currency-api"];

export type LastGood = { usd: number; eur: number } | null;

export type ResolvedCurrency = {
  // Null only when nothing believable arrived and there is nothing stored to hold.
  value: number | null;
  // Who backs the value used. Empty when the value is held.
  witnesses: RateSource[];
  // The value is the last good one, not today's reading.
  held: boolean;
  // One line for the log and for the daily diagnosis. Spanish: the owner reads it.
  reason: string;
};

export type Resolution = {
  // The day the vigente belongs to. Null when no source gave a dated reading for today or
  // before, which happens only when every source failed.
  date: string | null;
  usd: ResolvedCurrency;
  eur: ResolvedCurrency;
  prevista: DatedRate | null;
  // A currency could not be resolved at all: nothing believable and nothing to hold.
  needsReview: boolean;
};

type Candidate = { source: RateSource; value: number };
type Group = { value: number; sources: RateSource[] };

function agree(a: number, b: number): boolean {
  return Math.abs(a - b) / b <= AGREEMENT_TOLERANCE;
}

function groupByValue(candidates: Candidate[]): Group[] {
  const groups: Group[] = [];
  for (const c of candidates) {
    const g = groups.find((g) => agree(c.value, g.value));
    if (g) g.sources.push(c.source);
    else groups.push({ value: c.value, sources: [c.source] });
  }
  return groups;
}

function hold(name: string, last: number | null, why: string): ResolvedCurrency {
  return {
    value: last,
    witnesses: [],
    held: last !== null,
    reason: last !== null ? `${name}: se mantiene ${last}, ${why}` : `${name}: sin cifra, ${why}`,
  };
}

function resolveCurrency(name: string, candidates: Candidate[], last: number | null): ResolvedCurrency {
  const groups = groupByValue(candidates);
  const agreed = groups.filter((g) => g.sources.length >= 2).sort((a, b) => b.sources.length - a.sources.length)[0];
  if (agreed) {
    return { value: agreed.value, witnesses: agreed.sources, held: false, reason: `${name}: ${agreed.sources.join("+")} coinciden en ${agreed.value}` };
  }
  if (groups.length >= 2) {
    const arbiter = groups.find((g) => g.sources.includes(ARBITER));
    const listed = groups.map((g) => `${g.sources.join("+")}=${g.value}`).join(" · ");
    if (arbiter) {
      return { value: arbiter.value, witnesses: arbiter.sources, held: false, reason: `${name}: las fuentes discrepan (${listed}) y decide el BCV` };
    }
    return hold(name, last, `las fuentes discrepan (${listed}) y el BCV no contestó`);
  }
  if (groups.length === 1) {
    const only = groups[0];
    const who = only.sources[0];
    if (last === null) {
      return { value: only.value, witnesses: only.sources, held: false, reason: `${name}: un solo testigo (${who}) y nada guardado con qué compararlo` };
    }
    const drift = Math.abs(only.value - last) / last;
    if (drift <= SINGLE_WITNESS_TOLERANCE) {
      return { value: only.value, witnesses: only.sources, held: false, reason: `${name}: un solo testigo (${who}), a ${(drift * 100).toFixed(2)}% del último bueno` };
    }
    return hold(name, last, `el único testigo (${who}=${only.value}) está a ${(drift * 100).toFixed(1)}% del último bueno`);
  }
  return hold(name, last, "ninguna fuente dio una cifra creíble");
}

function byPreference(a: DatedRate, b: DatedRate): number {
  return PREFERENCE.indexOf(a.source) - PREFERENCE.indexOf(b.source);
}

// The next published rate that is not in force yet: the earliest future date, and within that
// day the value most sources agree on, else the most trusted source.
function pickPrevista(future: DatedRate[]): DatedRate | null {
  if (future.length === 0) return null;
  const date = future.map((r) => r.date).sort()[0];
  const ofDay = future.filter((r) => r.date === date).sort(byPreference);
  const groups: DatedRate[][] = [];
  for (const r of ofDay) {
    const g = groups.find((g) => agree(r.usd, g[0].usd) && agree(r.eur, g[0].eur));
    if (g) g.push(r);
    else groups.push([r]);
  }
  groups.sort((a, b) => b.length - a.length || byPreference(a[0], b[0]));
  return groups[0][0];
}

export function resolveOfficialRates(readings: DatedRate[], today: string, lastGood: LastGood): Resolution {
  const dated = readings.filter((r) => DATE_RE.test(r.date));
  const current = dated.filter((r) => r.date <= today);
  const date = current.length ? current.map((r) => r.date).sort().at(-1)! : null;
  const ofDay = date ? current.filter((r) => r.date === date) : [];

  // The dollar first: the euro is judged by its ratio to a dollar, and the dollar to trust is
  // the one just resolved, or failing that the last good one. A reading whose own dollar is
  // believable is judged against itself, which keeps the two numbers of one source together.
  const usd = resolveCurrency(
    "usd",
    ofDay.filter((r) => usdIsPlausible(r.usd)).map((r) => ({ source: r.source, value: r.usd })),
    lastGood?.usd ?? null,
  );
  const referenceUsd = usd.value ?? lastGood?.usd ?? null;
  const eur = resolveCurrency(
    "eur",
    ofDay
      .filter((r) => {
        const ref = usdIsPlausible(r.usd) ? r.usd : referenceUsd;
        return ref !== null && eurIsPlausible(ref, r.eur);
      })
      .map((r) => ({ source: r.source, value: r.eur })),
    lastGood?.eur ?? null,
  );

  const future = dated.filter((r) => r.date > today && usdIsPlausible(r.usd) && eurIsPlausible(r.usd, r.eur));

  return { date, usd, eur, prevista: pickPrevista(future), needsReview: usd.value === null || eur.value === null };
}

// "dolarapi+dolarvzla+bcv", the sources that backed at least one currency, plus which
// currencies are held. Stored in bcv_exchange_rate_fetches.source, a free text column, so the
// daily diagnosis can read from the table alone how each row was decided.
export function describeSources(resolution: Resolution): string {
  const witnesses = [...new Set([...resolution.usd.witnesses, ...resolution.eur.witnesses])];
  const held = [resolution.usd.held ? "usd" : null, resolution.eur.held ? "eur" : null].filter(Boolean);
  const parts = [witnesses.length ? witnesses.join("+") : "ninguna"];
  if (held.length) parts.push(`held:${held.join(",")}`);
  return parts.join(" ");
}
