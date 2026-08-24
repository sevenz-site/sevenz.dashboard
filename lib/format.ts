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

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// null covers both payments (no term applies) and charges left "sin
// especificar" — both render the same way, as "not applicable".
export function formatPlazoDias(days: number | null): string {
  return days == null ? "—" : `${days} días`;
}

// CSS truncate alone isn't enough on the movement-history rows: the title
// wraps to a second line before the browser gets a chance to ellipsize it,
// which pushes the row taller and breaks the amount's right alignment. A hard
// character cap keeps every row the same height regardless of description
// length.
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
