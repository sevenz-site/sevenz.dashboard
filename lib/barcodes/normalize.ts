// ONE SPELLING PER BARCODE (CT-182).
//
// A code is stored and searched in exactly the form this file returns, on both sides of
// the app (the server writing `product_barcodes`, the browser reading a scan). Migration
// 219 refuses any other form, so a code written by another door cannot slip past the
// unique index spelled differently.
//
// WHY THE UPC-A RULE. A 12-digit UPC-A and the 13-digit EAN-13 made of a leading 0 plus
// the same digits are the same package. A hand scanner usually sends the 12 digits; a
// phone camera often reports the 13. Without folding them, the second read answers «código
// nuevo», the shopkeeper creates a duplicate, and stock and reports split in two -- with
// no error anywhere. So 12 digits are stored as 0 + those 12.
//
// WHAT IS NOT FOLDED, said so nobody looks for it here: UPC-E (the 8-digit compressed
// UPC) is kept as its 8 digits, not expanded to UPC-A. A package read once as UPC-E and
// once as UPC-A would not match. Rare on what Venezuelan and Colombian shops sell; left
// out on purpose.

/** Shortest and longest code accepted, the same bounds as migration 219's check. */
export const BARCODE_MIN = 4;
export const BARCODE_MAX = 48;

/**
 * The stored form of a code, or null when there is nothing usable in it.
 * Keeps digits and Latin letters (uppercased); drops spaces, dashes and anything a
 * scanner or a hand may add around the code.
 */
export function normalizeBarcode(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (cleaned.length < BARCODE_MIN || cleaned.length > BARCODE_MAX) return null;
  if (/^\d{12}$/.test(cleaned)) return `0${cleaned}`;
  return cleaned;
}

/**
 * Whether a numeric retail code (EAN-8, EAN-13, ITF-14) has a correct check digit.
 * Codes of any other shape -- letters, other lengths -- answer true: they carry no check
 * digit this file can verify, and refusing them would refuse real internal labels.
 *
 * Used for codes TYPED by hand, where a wrong digit is almost always a typo. A camera or
 * a gun already verifies the check digit before reporting a retail code.
 */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 13, 14].includes(code.length)) return true;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  // From the right, the digits next to the check digit weigh 3, the next 1, alternating.
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Normalises a list of codes from a form: drops empties and repeats, keeps order.
 * Returns the codes that could not be read separately, so the form can name them.
 */
export function normalizeBarcodeList(raw: readonly string[] | null | undefined): {
  codes: string[];
  invalid: string[];
} {
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const value of raw ?? []) {
    if (!String(value ?? "").trim()) continue;
    const code = normalizeBarcode(value);
    if (!code || !hasValidCheckDigit(code)) {
      invalid.push(String(value).trim());
      continue;
    }
    if (!codes.includes(code)) codes.push(code);
  }
  return { codes, invalid };
}
