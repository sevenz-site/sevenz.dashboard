import type { ExchangeRateProvider, OfficialRates } from "@/lib/exchange-rate/types";

// ve.dolarapi.com — confirmed live and working (checked directly, not from
// docs): GET https://ve.dolarapi.com/v1/dolares/oficial returns
// {"moneda":"USD","fuente":"oficial","promedio":779.95,"fechaActualizacion":"..."}
// and /v1/euros/oficial returns the same shape for EUR. No auth required.
type DolarApiResponse = { promedio: number; fechaActualizacion: string };

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
      fetchedAt: new Date(),
    };
  }
}
