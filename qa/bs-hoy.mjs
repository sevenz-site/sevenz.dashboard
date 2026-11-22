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

// A line written by hand: the word next to a figure, or «al día del pago» typed out.
const escritaAMano = (linea) =>
  /(\}|\)|•) hoy\b/.test(linea) ||
  /al día del? pago/.test(linea) ||
  // The other two spellings the Figma file had: «Hoy:» in front, and a capital «Hoy» after.
  /[`"']Hoy: |Hoy: \$\{|(\}|\)) Hoy\b/.test(linea);
// A rate of the sale (`exchangeRateUsed`) is sealed and must not say «hoy».
const sinLaPalabra = (linea) =>
  /format(Bs|PriceAmount)\([^)]*\*\s*tasa\b/.test(linea) && !/(formatBsHoy|conHoy)\(/.test(linea);

const aMano = [];
const sinPalabra = [];
for (const ruta of [...archivos("app"), ...archivos("components"), ...archivos("lib")]) {
  if (ruta.replaceAll("\\", "/").endsWith("lib/exchange-rate/format.ts")) continue;
  readFileSync(ruta, "utf8").split(/\r?\n/).forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    if (escritaAMano(linea)) aMano.push(`${ruta}:${i + 1}`);
    if (sinLaPalabra(linea)) sinPalabra.push(`${ruta}:${i + 1}`);
  });
}

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa ? "" : `  — ${detalle}`}`);
};
// THE PATTERNS ARE TESTED BEFORE THE CODE. From 2026-11-06 to 2026-11-17 the `\b` of the
// capital-«Hoy» pattern was saved as a real backspace byte (0x08), so it matched nothing and
// this suite stayed green while two screens wrote «Bs. … Hoy». A blind regex looks exactly
// like a clean codebase; only feeding it known-bad lines tells the two apart.
const malas = [
  "<span>{valor.secondary} Hoy</span>",
  '{formatPriceAmount(x, "VES")} Hoy',
  "{formatBs(x)} hoy",
  "`Hoy: ${monto}`",
  "Bs. 10 al día de pago",
];
const buenas = ["{conHoy(valor.secondary)}", "{formatBsHoy(x)}", '<EmptyState title="Hoy no registraste nada" />'];
const ciegos = malas.filter((l) => !escritaAMano(l));
const falsos = buenas.filter((l) => escritaAMano(l));
check(
  "0. los patrones cazan las líneas malas de ejemplo y dejan pasar las buenas",
  ciegos.length === 0 && falsos.length === 0 && !sinLaPalabra("{formatBsHoy(a * tasa)}") && sinLaPalabra("{formatBs(a * tasa)}"),
  `no cazan: ${ciegos.join(" · ") || "—"}; cazan de más: ${falsos.join(" · ") || "—"}`,
);
check("1. nadie escribe «hoy» ni «al día del pago» a mano junto a una cifra", aMano.length === 0, aMano.join(", "));
check("2. bolívares calculados con la tasa llevan «hoy»", sinPalabra.length === 0, sinPalabra.join(", "));
console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
process.exit(filas.every(Boolean) ? 0 : 1);
