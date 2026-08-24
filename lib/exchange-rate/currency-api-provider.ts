import type { ExchangeRateProvider, OfficialRates } from "@/lib/exchange-rate/types";

// Fallback for when dolarapi is unreachable. The design doc originally
// specified bcv.today, but that domain doesn't resolve at all (confirmed
// directly — DNS failure, not a 404). pydolarve.org (the other well-known
// Venezuela rate aggregator) has also expired. This is a free, no-auth,
// actively-maintained alternative (fawazahmed0/currency-api, mirrored via
// jsDelivr's CDN) whose VES values track closely with dolarapi's (checked
// directly: 777.92 vs dolarapi's 779.95 for USD at the same moment).
const TIMEOUT_MS = 8_000;

async function fetchVesRate(baseCurrency: "usd" | "eur"): Promise<number> {
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency}.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
    const data = (await response.json()) as Record<string, Record<string, number>>;
    const ves = data[baseCurrency]?.ves;
    if (!ves) throw new Error(`currency-api no incluyó VES para ${baseCurrency}.`);
    return ves;
  } finally {
    clearTimeout(timeout);
  }
}

export class CurrencyApiProvider implements ExchangeRateProvider {
  async getOfficialRates(): Promise<OfficialRates> {
    const [usd, eur] = await Promise.all([fetchVesRate("usd"), fetchVesRate("eur")]);

    return {
      usd,
      eur,
      source: "currency-api",
      fetchedAt: new Date(),
    };
  }
}
