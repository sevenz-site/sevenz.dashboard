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

// Letters that are allowed to lead the value, per country. Everything else in
// the string has to be digits or punctuation.
function allowedPrefix(country: DocumentCountry): RegExp | null {
  return country === "VE" ? /^v/i : null;
}

export type ParsedDocumentId = { digits: string; legacy: boolean };

// Splits a stored value into what the digits box should show.
//
// BARE DIGITS ARE NOT LEGACY, and getting this wrong is what the measurement
// caught: of the 158 documents in production, ZERO already had a prefix and
// 154 were bare digits. Treating those as malformed would have put a
// "saved in another format" note on 97% of the records — a warning that fires
// almost always is not information, it is noise.
//
// A bare "12345678" under a Venezuelan shopkeeper is a correct document that
// is missing a prefix nobody was asking for until today. So it goes straight
// into the digits box. Same for punctuation: "12.345.678" is a real document
// someone typed with dots.
//
// `legacy` is left for what genuinely cannot be shown in a digits box —
// "pendiente", "no tiene", a foreign "E-12345678". Those are NOT rewritten:
// reshaping one on open would turn an "E-" into a "V-" just because someone
// opened a dialog, which is changing a person's nationality by accident.
export function parseDocumentId(stored: string, country: DocumentCountry): ParsedDocumentId {
  const value = (stored ?? "").trim();
  if (value === "") return { digits: "", legacy: false };

  const prefix = allowedPrefix(country);
  const body = prefix ? value.replace(prefix, "") : value;

  // Anything left that is not a digit or punctuation means we cannot show it.
  if (/[a-z]/i.test(body)) return { digits: "", legacy: true };

  const digits = body.replace(/\D/g, "");
  if (digits === "") return { digits: "", legacy: true };
  return { digits, legacy: false };
}

export function composeDocumentId(digits: string, country: DocumentCountry): string {
  if (digits === "") return "";
  return `${country ? DOCUMENT_PREFIX[country] : ""}${digits}`;
}
