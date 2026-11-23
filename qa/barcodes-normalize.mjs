// qa:barcodes-normalize (CT-182). The one spelling of a barcode, checked with real cases:
// a 12-digit UPC-A and its 13-digit EAN form must become the same code, a typo in the check
// digit must be caught, and a shop's own alphanumeric label must survive. No database.
//
// Run from dashboard/: `npm run qa:barcodes-normalize`.
import { hasValidCheckDigit, normalizeBarcode, normalizeBarcodeList } from "../lib/barcodes/normalize.ts";

const cases = [
  ["UPC-A de 12 dígitos se guarda como su EAN-13", normalizeBarcode("012345678905") === "0012345678905"],
  ["El mismo producto leído como EAN-13 da el mismo código", normalizeBarcode("0012345678905") === normalizeBarcode("012345678905")],
  ["Espacios y guiones se quitan", normalizeBarcode(" 759-1234 567894 ") === "7591234567894"],
  ["Letras en minúscula pasan a mayúscula", normalizeBarcode("abc-123") === "ABC123"],
  ["Menos de 4 caracteres no es un código", normalizeBarcode("123") === null],
  ["Vacío no es un código", normalizeBarcode("   ") === null],
  ["EAN-13 con dígito de control correcto", hasValidCheckDigit("7591234567894")],
  ["EAN-13 con un dígito cambiado se rechaza", !hasValidCheckDigit("7591234567895")],
  ["EAN-8 correcto (96385074)", hasValidCheckDigit("96385074")],
  ["UPC-A normalizado valida como EAN-13", hasValidCheckDigit(normalizeBarcode("012345678905"))],
  ["Una etiqueta propia alfanumérica no se rechaza", hasValidCheckDigit("ABC123")],
  [
    "La lista quita repetidos (UPC y EAN del mismo) y vacíos",
    JSON.stringify(normalizeBarcodeList(["012345678905", "0012345678905", "", "7591234567894"]).codes) ===
      JSON.stringify(["0012345678905", "7591234567894"]),
  ],
  ["La lista nombra el código inválido", normalizeBarcodeList(["7591234567895"]).invalid[0] === "7591234567895"],
];

let fails = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s).` : `\n${cases.length}/${cases.length} bien.`);
process.exit(fails ? 1 : 0);
