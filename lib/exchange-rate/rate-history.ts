import { eurIsPlausible, usdIsPlausible } from "@/lib/exchange-rate/rate-guard";

export type RateHistoryPoint = {
  date: string; // YYYY-MM-DD
  usd: number;
  eur: number;
};

type HistoricoEntry = { promedio: number; fecha: string };
type VzlaEntry = { date: string; usd: number; eur: number };

const HISTORY_DAYS = 90;

async function fetchHistorico(url: string): Promise<HistoricoEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return (await response.json()) as HistoricoEntry[];
}

// DolarVZLA publishes one list per month, newest first, mirroring the BCV with no
// transformation. Four months cover the 90-day window with a margin. A month that fails is
// simply absent: the history then shows DolarApi's days only, as it did before 2026-11-05.
async function fetchDolarVzlaByDate(): Promise<Map<string, VzlaEntry>> {
  const now = new Date();
  const months = [0, 1, 2, 3].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}`;
  });
  const lists = await Promise.allSettled(
    months.map(async (ym) => {
      const response = await fetch(`https://rates.dolarvzla.com/bcv/${ym}/list.json`);
      if (!response.ok) throw new Error(`dolarvzla ${ym} respondió ${response.status}`);
      return (await response.json()) as VzlaEntry[];
    }),
  );
  const byDate = new Map<string, VzlaEntry>();
  for (const list of lists) {
    if (list.status !== "fulfilled" || !Array.isArray(list.value)) continue;
    for (const entry of list.value) byDate.set(entry.date, entry);
  }
  return byDate;
}

// Module-scoped, not component state — the calculator's Drawer/Popover
// content unmounts when closed (Radix's default), so without this a
// re-open of the "Calcular" panel would refetch the same days again.
// Cached for the lifetime of the page; a hard refresh starts fresh, which
// is fine for a "recent trend" chart.
let cachedHistory: Promise<RateHistoryPoint[]> | null = null;

// ve.dolarapi.com's historicos endpoints return a currency's FULL daily
// series since Jan 2023 in one call — there's no "last N days" param, so
// the HISTORY_DAYS window is applied client-side after fetching both
// currencies. Ninety days: long enough for the table to be worth filtering,
// and the ceiling on what the date picker offers — a calendar that lets you
// pick a month with no data behind it is a dead end dressed as a feature.
//
// A DAY DOLARAPI GOT WRONG IS TAKEN FROM DOLARVZLA, and only dropped when neither has it
// right. Since 2026-11-05 DolarApi's euro reads 1,006 for every day past Bs. 1.000, so without
// the second source the table would simply end on 2026-11-04 and stay there.
export function getRateHistory(): Promise<RateHistoryPoint[]> {
  if (!cachedHistory) {
    cachedHistory = Promise.all([
      fetchHistorico("https://ve.dolarapi.com/v1/historicos/dolares/oficial"),
      fetchHistorico("https://ve.dolarapi.com/v1/historicos/euros/oficial"),
      fetchDolarVzlaByDate(),
    ])
      .then(([usdHistory, eurHistory, vzla]) => {
        const eurByDate = new Map(eurHistory.map((entry) => [entry.fecha, entry.promedio]));
        const merged: RateHistoryPoint[] = [];
        for (const entry of usdHistory) {
          const eur = eurByDate.get(entry.fecha);
          if (eur !== undefined && usdIsPlausible(entry.promedio) && eurIsPlausible(entry.promedio, eur)) {
            merged.push({ date: entry.fecha, usd: entry.promedio, eur });
            continue;
          }
          const alt = vzla.get(entry.fecha);
          if (alt && usdIsPlausible(alt.usd) && eurIsPlausible(alt.usd, alt.eur)) {
            merged.push({ date: alt.date, usd: alt.usd, eur: alt.eur });
          }
        }
        return merged.slice(-HISTORY_DAYS);
      })
      .catch((err) => {
        cachedHistory = null; // let the next open retry instead of caching a failure
        throw err;
      });
  }
  return cachedHistory;
}
