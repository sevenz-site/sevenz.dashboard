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
  // "V-12345678" -> "V-12.345.678". Since 2026-09-17 a Venezuelan document is
  // stored with its prefix, so grouping only pure digits would have quietly
  // stopped grouping every new Venezuelan record.
  const prefixed = /^([A-Za-z]-)(\d+)$/.exec(documentId);
  if (prefixed) return `${prefixed[1].toUpperCase()}${group(prefixed[2])}`;
  if (!/^\d+$/.test(documentId)) return documentId;
  return group(documentId);
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Strips punctuation/spacing so "555.111.222" and "555 111 222" compare equal
// to "555111222" — document_id is stored exactly as typed with no fixed
// format, so duplicate detection has to normalize before comparing.
//
// AND STRIPS A LEADING COUNTRY LETTER, since 2026-09-17. Without that, the
// prefixed field silently broke duplicate detection: a client already on file
// as "12345678" and a new registration typed as "V-12345678" stopped matching,
// so the shopkeeper would end up with two records for the same person — the
// exact thing this guard exists to prevent.
//
// The consequence, accepted on purpose: a legacy "E-12345678" now collides
// with "V-12345678". That is tolerable because a duplicate here is a WARNING,
// not a merge — the shopkeeper is shown the existing client and can still
// choose "Crear cuenta separada". Missing a real duplicate is silent; a false
// one is a question on screen.
//
// Only a single letter, and only when digits follow it, so "pendiente" still
// compares as itself rather than collapsing into "endiente".
export function normalizeDocumentId(documentId: string): string {
  return documentId
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .replace(/^[a-z](?=\d)/, "");
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
