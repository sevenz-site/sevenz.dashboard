export type OfficialRates = {
  usd: number; // Bs per 1 USD
  eur: number; // Bs per 1 EUR
  source: string;
  fetchedAt: Date;
};

export interface ExchangeRateProvider {
  getOfficialRates(): Promise<OfficialRates>;
}
