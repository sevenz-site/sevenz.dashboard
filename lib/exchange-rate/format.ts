// Bs is formatted manually (not via Intl's "VES" currency code) because ICU
// data renders the VES symbol inconsistently across environments (Bs.S vs
// VES vs Bs.) — the design doc's examples always show the literal "Bs. "
// prefix, so that's what every surface should match exactly.
const bsNumberFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBs(amount: number): string {
  return `Bs. ${bsNumberFormatter.format(amount)}`;
}

const displayCurrencyFormatters: Record<"USD" | "EUR", Intl.NumberFormat> = {
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  EUR: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

export function formatDisplayCurrency(amount: number, currency: "USD" | "EUR"): string {
  return displayCurrencyFormatters[currency].format(amount);
}
