// What a client's document field can hold.
//
// THE STORED VALUE IS DIGITS. Nothing else — no prefix, no dots, no letters.
// An earlier version stored "V-12345678" for Venezuelan records and it was
// dropped on 2026-09-17, before it ever reached production, because the prefix
// carried no information: every Venezuelan record got the same letter, the
// country already lives in `clients.document_country` since migration 035, and
// normalizeDocumentId had to strip the letter again to compare two records. It
// was written only to be ignored, and it broke duplicate detection on the way.
//
// The "V-" a Venezuelan shopkeeper sees is a cue printed NEXT TO the box, not
// part of the value. See DocumentIdInput.
//
// Kept in its own module, away from the component, so the rules can be tested
// without a browser: a .tsx file cannot be imported by a plain Node script.

export type ParsedDocumentId = { digits: string; legacy: boolean };

// Splits a stored value into what the digits box should show.
//
// Punctuation is not a defect: "12.345.678" is a real document someone typed
// with dots, and it shows as its digits. Of the 158 documents in production,
// 154 are already bare digits and 4 are something else.
//
// `legacy` is only for a value with LETTERS in it — "pendiente" from a
// shopkeeper filling the form to get past it, or a foreign "E-12345678". Those
// are never rewritten. Showing an "E-12345678" in a digits box would drop the
// E the next time anyone saved the form, and that is losing a real fact about
// a person because someone opened a dialog.
export function parseDocumentId(stored: string): ParsedDocumentId {
  const value = (stored ?? "").trim();
  if (value === "") return { digits: "", legacy: false };
  if (/[a-z]/i.test(value)) return { digits: "", legacy: true };

  const digits = value.replace(/\D/g, "");
  if (digits === "") return { digits: "", legacy: true };
  return { digits, legacy: false };
}
