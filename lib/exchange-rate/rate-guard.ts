// IS THIS RATE BELIEVABLE?
//
// On 2026-11-05 the official euro crossed Bs. 1.000, and ve.dolarapi.com started
// returning `promedio: 1.006`: the thousands dot of «1.006,xx» read as a decimal. Nothing
// failed and the provider answered 200. A rate of 1,006 would have let a client clear €100
// with Bs. 100.
//
// WHY A RATIO AND NOT ONLY A COMPARISON WITH YESTERDAY. It has to work with no previous row:
// in the rate history and the prevista there is none. And a comparison with the last stored
// euro can get stuck: that value may itself be a held one, so a source that recovers after
// the bolívar moved 15% would be refused forever, in silence. The ratio cannot do that: a
// true euro is always inside the band, so the guard lets go on its own the day the source
// heals. The euro has stayed between 0,82 and 1,60 dollars since it exists.
//
// WHAT THE RATIO CANNOT SEE: both numbers broken the same way, which is what will happen if
// the dollar crosses Bs. 1.000 with the provider still reading the dot as a decimal
// (1,002 and 1,120 make a perfect ratio). That is what the floor is for. It is far below any
// real rate and far above any broken one. A redenomination of the bolívar would trip it, and
// should: that day a person has to look.
const MIN_EUR_PER_USD = 0.7;
const MAX_EUR_PER_USD = 1.6;
export const MIN_BS_PER_USD = 100;

export function usdIsPlausible(usd: number): boolean {
  return Number.isFinite(usd) && usd >= MIN_BS_PER_USD;
}

export function eurIsPlausible(usd: number, eur: number): boolean {
  if (!usdIsPlausible(usd) || !Number.isFinite(eur) || eur <= 0) return false;
  const ratio = eur / usd;
  return ratio >= MIN_EUR_PER_USD && ratio <= MAX_EUR_PER_USD;
}

type StoredRate = { usd: number | string; eur: number | string };

// The newest stored row whose euro makes sense. NOT simply the newest row: a broken one can
// already be in the table, written by an older deploy, and keeping "the last official euro"
// would then keep the broken number for good. Reproduced in dev on 2026-11-05 with a real
// row, before this existed: the fetch answered `eur_held: true` and stored 1,006.
export function lastGoodRate(recent: StoredRate[]): { usd: number; eur: number } | null {
  for (const row of recent) {
    const usd = Number(row.usd);
    const eur = Number(row.eur);
    if (eurIsPlausible(usd, eur)) return { usd, eur };
  }
  return null;
}
