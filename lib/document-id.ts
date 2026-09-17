import type { OwnerCountry } from "@/lib/types";

// How a client's document is shaped, per country.
//
// Kept apart from the component that renders it so the rules can be tested on
// their own — a .tsx file cannot be imported by a plain Node script, and these
// are exactly the rules worth pinning down with tests.
//
// VENEZUELA GETS "V-" AND NOTHING ELSE. Not a V/E picker: decided 2026-09-17,
// with the consequence stated and accepted — a foreign resident's cédula, which
// is written "E-", is stored as "V-". If that ever has to change, this is the
// file, and the values stored before the change are the migration.
//
// COLOMBIA GETS NO PREFIX. A Colombian cédula is plain digits. Forcing "V-" on
// a Cúcuta shopkeeper's clients would write a false fact into every new record,
// and half the businesses on Sevenz are Colombian.
export const DOCUMENT_PREFIX: Record<OwnerCountry, string> = { VE: "V-", CO: "" };

// The country can be unknown on the public share page, where it arrives from
// get_shared_balance and is typed as nullable. Unknown means NO PREFIX and
// digits only: it still keeps "pendiente" out, and it does not invent a
// nationality for someone whose country we could not read.
export type DocumentCountry = OwnerCountry | null;

function shapeFor(country: DocumentCountry): RegExp {
  return country === "VE" ? /^V-?(\d*)$/i : /^(\d*)$/;
}

export type ParsedDocumentId = { digits: string; legacy: boolean };

// Splits a stored value into what the digits box should show.
//
// `legacy` means "this does not fit the shape" — "12.345.678" from before the
// rule, or "pendiente" from a shopkeeper filling the form to get past it. Those
// are NOT rewritten: the documents already in production stay exactly as they
// are (decided 2026-09-17), and silently reshaping one on open would turn an
// "E-12345678" into "V-12345678" just because someone opened a dialog. That is
// changing a person's nationality by accident.
export function parseDocumentId(stored: string, country: DocumentCountry): ParsedDocumentId {
  const value = (stored ?? "").trim();
  if (value === "") return { digits: "", legacy: false };
  const match = shapeFor(country).exec(value);
  if (!match) return { digits: "", legacy: true };
  return { digits: match[1] ?? "", legacy: false };
}

export function composeDocumentId(digits: string, country: DocumentCountry): string {
  if (digits === "") return "";
  return `${country ? DOCUMENT_PREFIX[country] : ""}${digits}`;
}
