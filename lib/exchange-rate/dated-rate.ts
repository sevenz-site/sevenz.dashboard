// ONE READING OF THE OFFICIAL RATE, as a source publishes it.
//
// `date` is the day the rate is valid for, never the day we asked. That distinction is the
// whole reason three sources can be compared at all: on a Friday afternoon the BCV already
// shows Monday's rate, DolarVZLA's `current.json` carries Monday's date, and DolarApi still
// answers Friday's. They are not disagreeing; they are talking about different days. The
// resolver (resolve-rates.ts) groups readings by date before it compares anything.
export type RateSource = "dolarapi" | "dolarvzla" | "bcv" | "currency-api";

export type DatedRate = {
  date: string; // YYYY-MM-DD
  usd: number; // Bs per 1 USD
  eur: number; // Bs per 1 EUR
  source: RateSource;
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "1.006,03263992" -> 1006.03263992 · "894,88760000" -> 894.8876 · "1.006" -> 1006.
//
// The BCV prints its rates the Venezuelan way, dot for thousands and comma for decimals, and
// that is exactly the format that broke DolarApi on 2026-11-05. The one ambiguous case, a
// number with dots and no comma, is read as thousands only when every group after the first
// has three digits: "1.006" is a thousand and six, "894.8876" is not a Venezuelan number and
// is read as a plain decimal.
export function parseVenezuelanNumber(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9.,]+$/.test(t)) return null;
  let normalized: string;
  if (t.includes(",")) normalized = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normalized = t.replace(/\./g, "");
  else normalized = t;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}
