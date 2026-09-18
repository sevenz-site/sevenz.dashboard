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

// Cédula-style grouping (23.845.083) — only applied to purely numeric
// documents; a document with letters (e.g. a foreigner ID prefix) is shown
// exactly as stored rather than guessed at.
export function formatDocumentId(documentId: string | null): string {
  if (!documentId) return "—";
  if (!/^\d+$/.test(documentId)) return documentId;
  return documentId.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Strips punctuation/spacing so "555.111.222" and "555 111 222" compare equal
// to "555111222" — older records were stored exactly as typed with no fixed
// format, so duplicate detection has to normalize before comparing.
//
// The document field only accepts digits since 2026-09-17, so new records need
// no normalising at all. This still matters for the ones stored before that.
export function normalizeDocumentId(documentId: string): string {
  return documentId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
