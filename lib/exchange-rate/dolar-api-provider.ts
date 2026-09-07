import type { ExchangeRateProvider, OfficialRates } from "@/lib/exchange-rate/types";

// ve.dolarapi.com — confirmed live and working (checked directly, not from
// docs): GET https://ve.dolarapi.com/v1/dolares/oficial returns
// {"moneda":"USD","fuente":"oficial","promedio":779.95,"fechaActualizacion":"..."}
// and /v1/euros/oficial returns the same shape for EUR. No auth required.
type DolarApiResponse = { promedio: number; fechaActualizacion: string };

// "2026-09-04T00:00:00-04:00" -> "2026-09-04". Sliced off the string rather
// than parsed into a Date: the value already carries Venezuela's offset, and
// re-reading it in the server's timezone (Vercel runs UTC) is what would slide
// it a day — the exact class of error this field exists to fix.
function rateDateOf(iso: string | undefined): string | null {
  if (!iso || iso.length < 10) return null;
  const ymd = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

const TIMEOUT_MS = 8_000;

async function fetchOficial(url: string): Promise<DolarApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
    return (await response.json()) as DolarApiResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export class DolarApiProvider implements ExchangeRateProvider {
  async getOfficialRates(): Promise<OfficialRates> {
    const [usdData, eurData] = await Promise.all([
      fetchOficial("https://ve.dolarapi.com/v1/dolares/oficial"),
      fetchOficial("https://ve.dolarapi.com/v1/euros/oficial"),
    ]);

    if (!usdData.promedio || !eurData.promedio) {
      throw new Error("dolarapi no devolvió un promedio válido.");
    }

    return {
      usd: usdData.promedio,
      eur: eurData.promedio,
      source: "dolarapi",
      // USD's date, not EUR's: the two are published together by the BCV and
      // the calculator shows one stamp for both. If they ever disagree the USD
      // one is the number owners price against.
      rateDate: rateDateOf(usdData.fechaActualizacion),
      fetchedAt: new Date(),
    };
  }
}
