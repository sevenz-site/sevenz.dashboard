// «HOY» HAS ONE SPELLING: `conHoy` and `formatBsHoy`, in lib/exchange-rate/format.ts.
//
// Owner's request of 2026-11-06: one standard for the whole app. No database, one second.
// It reads the code and fails on the two ways the standard gets lost:
//   1. the word typed by hand next to a figure, which is how each screen drifts on its own;
//   2. bolivars worked out from a rate with no word at all, which is how a report ended up
//      showing a period's total as if that were what it was worth then.
//
// What it cannot see: a figure computed in another variable and then formatted. That is what
// a read of CLAUDE.md is for.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const archivos = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const ruta = join(dir, e.name);
  if (e.isDirectory()) return archivos(ruta);
  return /\.tsx?$/.test(e.name) ? [ruta] : [];
});

const aMano = [];
const sinPalabra = [];
for (const ruta of [...archivos("app"), ...archivos("components"), ...archivos("lib")]) {
  if (ruta.replaceAll("\\", "/").endsWith("lib/exchange-rate/format.ts")) continue;
  readFileSync(ruta, "utf8").split(/\r?\n/).forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    if (/(\}|\)|•) hoy\b/.test(linea)) aMano.push(`${ruta}:${i + 1}`);
    if (/al día del? pago/.test(linea)) aMano.push(`${ruta}:${i + 1}`);
    // The other two spellings the Figma file had: «Hoy:» in front, and a capital «Hoy» after.
    if (/[`"']Hoy: |Hoy: \$\{|(\}|\)) Hoy/.test(linea)) aMano.push(`${ruta}:${i + 1}`);
    // A rate of the sale (`exchangeRateUsed`) is sealed and must not say «hoy».
    if (/format(Bs|PriceAmount)\([^)]*\*\s*tasa\b/.test(linea) && !/(formatBsHoy|conHoy)\(/.test(linea)) sinPalabra.push(`${ruta}:${i + 1}`);
  });
}

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa ? "" : `  — ${detalle}`}`);
};
check("1. nadie escribe «hoy» ni «al día del pago» a mano junto a una cifra", aMano.length === 0, aMano.join(", "));
check("2. bolívares calculados con la tasa llevan «hoy»", sinPalabra.length === 0, sinPalabra.join(", "));
console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
process.exit(filas.every(Boolean) ? 0 : 1);
