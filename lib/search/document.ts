import { foldForSearch } from "@/lib/search/fold";

// WHETHER A SEARCH FINDS A CLIENT BY HIS DOCUMENT, in every client search of the app: Inicio and
// Clientes (`client-filters.tsx`), the client picker of a payment (`client-search-dialog.tsx`) and
// the client filter of Reportes (`reportes-controls.tsx`). One function so the three cannot
// disagree about who exists.
//
// WHY IT IS NOT A PLAIN `includes` (owner's request of 2026-11-27: «El search de buscar debe
// permitir buscar por documento sin el prefijo»). The app SHOWS a document as «V-13.549.859» but
// stores it as `document_type` «V» plus `document_id` «13549859», so typing what is on screen
// found nobody. Measured in dev that day: «13549859» and «1354» found Rafael Colmenares;
// «13.549.859», «V-13.549.859», «V13549859» and «V-13549859» found no one. And the other way
// round: a few documents are stored with dots or with the letter inside `document_id` (photo
// imports, older entries), and those were not found by their bare digits.
//
// So both sides are compared as letters and digits only: dots, dashes and spaces are dropped.
// The prefix is optional; when it is typed it has to be the client's (an «E» does not find a «V»),
// glued in front of the number whether it lives in `document_type` or inside `document_id`.
//
// ONLY WHEN THE QUERY HAS A DIGIT. Without that, a lone «v» would match every client with a
// Venezuelan ID and drown the names that start with V. Names never carry digits, so a query with
// none is a name search and goes through the caller's name comparison alone.
const compact = (text: string | null | undefined) => foldForSearch(text).replace(/[^a-z0-9]/g, "");

export function matchesClientDocument(
  query: string,
  documentId: string | null | undefined,
  documentType?: string | null,
): boolean {
  const q = compact(query);
  if (!q || !/\d/.test(q)) return false;
  const id = compact(documentId);
  if (!id) return false;
  if (id.includes(q)) return true;
  const type = compact(documentType);
  // The letter lives in `document_type` for almost every client; glued in front it reads as the
  // screen shows it. Skipped when `document_id` already starts with it, so «V» is not doubled.
  return type !== "" && !id.startsWith(type) && (type + id).includes(q);
}
