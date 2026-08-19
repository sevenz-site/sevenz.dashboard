// Always shows both decimals — amounts are numeric(12,2) in the database, and
// rounding a displayed figure while summing the exact stored values elsewhere
// (e.g. dashboard totals) can make line items look like they don't add up.
const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}
