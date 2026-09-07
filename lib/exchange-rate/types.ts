export type OfficialRates = {
  usd: number; // Bs per 1 USD
  eur: number; // Bs per 1 EUR
  source: string;
  // The day the BCV rate itself belongs to, "YYYY-MM-DD". Distinct from
  // fetchedAt on every weekend and holiday: the BCV does not publish then, so
  // a Sunday fetch returns Friday's rate. Null from currency-api, which
  // publishes no date of its own.
  rateDate: string | null;
  // When WE asked. Only ever used to decide whether the stored rate is stale
  // enough to refetch — never to tell an owner which rate they are looking at.
  fetchedAt: Date;
};

export interface ExchangeRateProvider {
  getOfficialRates(): Promise<OfficialRates>;
}
