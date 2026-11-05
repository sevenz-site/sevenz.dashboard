import { DATE_RE, type DatedRate } from "@/lib/exchange-rate/dated-rate";

// rates.dolarvzla.com: static JSON files that mirror the BCV's page, free, no key, CORS open.
// Terms read on 2026-11-05 (https://dolarvzla.com/terminos): use «de tu negocio» is allowed,
// the figures themselves are public data they claim no ownership of, and they may block an
// origin that reads abusively or resells the data as its own. We read at most once every 20
// minutes while someone uses the app, and the owner asked them for written permission the
// same day. If they ever block us, this source fails and the other two carry on; nothing
// false gets in.
//
// Measured on 2026-11-05: 66 days compared with DolarApi's series, zero differences except
// the day DolarApi broke. Response in 200-400 ms.
//
// THE TRAP: `current.json` carries TOMORROW's rate from the afternoon before. The file dated
// 2026-11-05 was modified on 2026-11-04 at 16:30 Caracas. So `current` is not "today's rate";
// it is "the newest published one", which on a Friday afternoon is Monday's. Both entries go
// to the resolver as dated readings and it sorts out which is in force and which is the
// prevista; nothing here decides that.
const CURRENT_URL = "https://rates.dolarvzla.com/bcv/current.json";
const TIMEOUT_MS = 8_000;

type VzlaRate = { date: string; usd: number; eur: number };
type VzlaCurrent = { current: VzlaRate; previous?: VzlaRate };

function asReading(entry: VzlaRate | undefined): DatedRate | null {
  if (!entry || !DATE_RE.test(entry.date)) return null;
  if (typeof entry.usd !== "number" || typeof entry.eur !== "number") return null;
  return { date: entry.date, usd: entry.usd, eur: entry.eur, source: "dolarvzla" };
}

export async function readDolarVzla(): Promise<DatedRate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CURRENT_URL, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`dolarvzla respondió ${res.status}`);
    const data = (await res.json()) as VzlaCurrent;
    const readings = [asReading(data.current), asReading(data.previous)].filter((r): r is DatedRate => r !== null);
    if (readings.length === 0) throw new Error("dolarvzla no devolvió una tasa con fecha.");
    return readings;
  } finally {
    clearTimeout(timeout);
  }
}
