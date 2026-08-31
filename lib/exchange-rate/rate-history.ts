export type RateHistoryPoint = {
  date: string; // YYYY-MM-DD
  usd: number;
  eur: number;
};

type HistoricoEntry = { promedio: number; fecha: string };

const HISTORY_DAYS = 7;

async function fetchHistorico(url: string): Promise<HistoricoEntry[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return (await response.json()) as HistoricoEntry[];
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
// currencies. Kept short (a week, not months) — Venezuela's rate moves
// fast enough that a longer window reads as noise rather than signal for
// a "what's the trend right now" glance.
export function getRateHistory(): Promise<RateHistoryPoint[]> {
  if (!cachedHistory) {
    cachedHistory = Promise.all([
      fetchHistorico("https://ve.dolarapi.com/v1/historicos/dolares/oficial"),
      fetchHistorico("https://ve.dolarapi.com/v1/historicos/euros/oficial"),
    ])
      .then(([usdHistory, eurHistory]) => {
        const eurByDate = new Map(eurHistory.map((entry) => [entry.fecha, entry.promedio]));
        const merged = usdHistory
          .filter((entry) => eurByDate.has(entry.fecha))
          .map((entry) => ({
            date: entry.fecha,
            usd: entry.promedio,
            eur: eurByDate.get(entry.fecha)!,
          }));
        return merged.slice(-HISTORY_DAYS);
      })
      .catch((err) => {
        cachedHistory = null; // let the next open retry instead of caching a failure
        throw err;
      });
  }
  return cachedHistory;
}
