// Every runnable script under qa/ is reachable with an `npm run qa:*`.
//
// Needs no database, no network and no browser. It answers one question: can
// somebody who did not write a suite still find it?
//
// ===========================================================================
// WHY THIS EXISTS
//
// On 2026-10-23, running the whole suite before a production launch turned up
// two scripts with no `npm run` entry at all: `qa/monto-bolivares.mjs` and
// `qa/fixtures-venta-colombia.mjs`. Both still passed when invoked by hand.
// That is precisely what makes the failure quiet — nothing is broken, the file
// is simply invisible.
//
// WHAT IT COSTS, and it is not "one suite not run". The checklist is walked by
// reading `package.json`: a suite missing from there is missing from every
// future launch, and its absence reads as coverage that was never written
// rather than coverage that was lost. `qa/monto-bolivares.mjs` guards the
// bolivars-to-ledger conversion — the arithmetic between what the shopkeeper
// types and what gets stored — so its silence would have been a money check
// nobody noticed was gone.
//
// ===========================================================================
// WHY A SHARED MODULE IS NOT AN ORPHAN, AND WHY THAT IS COMPUTED
//
// `qa/plantillas-esperadas.mjs` has no entry and must not have one: it is a
// table three suites import, not a script to run. So the rule is "has an entry
// OR somebody imports it", and the second half is READ FROM THE FILES rather
// than kept as a list of exceptions here.
//
// That is deliberate and CLAUDE.md says why: a hand-kept exception list has to
// be maintained, and an out-of-date list fails in silence — the exact failure
// mode this script exists to close. Computed from the imports, a module that
// stops being imported stops being excused on its own.
//
// WHAT IT DELIBERATELY DOES NOT CHECK. Not whether the entry runs the script
// correctly — the type-stripping flag, the hooks import. A wrong flag fails
// loudly the first time anyone runs it, which is the kind of failure that needs
// no guard.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "qa";
// Where an import of a qa/ module could legally come from. Not the whole repo:
// a prose mention of a filename inside a comment is not an import, and the
// narrower the haystack the fewer ways this has to be wrong.
const CARPETAS = ["qa", "lib", "app", "components", "hooks", "analytics", "scripts"];

const guiones = readdirSync(DIR)
  .filter((f) => f.endsWith(".mjs") || f.endsWith(".mts"))
  .sort();

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
const comandos = Object.values(scripts).join("\n");

// Everything a file could say to pull in another one. The specifier is matched
// by its tail, so "./plantillas-esperadas.mjs" and "../qa/plantillas-esperadas.mjs"
// both count.
const ESPECIFICADOR = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

const importados = new Set();
const recorre = (dir) => {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Una carpeta que no existe en este repo no es un fallo.
  }
  for (const e of entradas) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      recorre(path);
      continue;
    }
    if (!/\.(mjs|mts|ts|tsx|js|jsx)$/.test(e.name)) continue;
    const body = readFileSync(path, "utf8");
    for (const [, spec] of body.matchAll(ESPECIFICADOR)) {
      const base = spec.split("/").pop();
      // Un archivo que se importa a sí mismo no se salva por ello.
      if (base && base !== e.name) importados.add(base);
    }
  }
};
for (const c of CARPETAS) recorre(c);

let fallos = 0;
const huerfanos = [];

for (const name of guiones) {
  const tieneEntrada = comandos.includes(`${DIR}/${name}`);
  const esModulo = importados.has(name);
  if (tieneEntrada || esModulo) continue;
  huerfanos.push(name);
  fallos++;
}

console.log(`Guiones en ${DIR}/: ${guiones.length}`);
console.log(`Con entrada en package.json o importados por otro: ${guiones.length - fallos}`);
console.log("");

if (fallos === 0) {
  console.log(`ALL GREEN — ${guiones.length} guiones, ninguno huérfano`);
} else {
  for (const name of huerfanos) {
    console.log(`FAIL  ${name} — sin "npm run qa:*" y nadie lo importa`);
  }
  console.log("");
  console.log(`FAILURES: ${fallos} de ${guiones.length}`);
  console.log("");
  console.log('Añade su línea en "scripts" de package.json, con el mismo patrón que');
  console.log("sus vecinos. Si el guion importa un .ts del repo necesita además");
  console.log("--experimental-strip-types, y si lee .env.local, --import ./analytics/register-hooks.mjs.");
  console.log("");
  console.log("Si de verdad NO es un guion sino un módulo que otros importan, no le");
  console.log("pongas entrada: haz que alguien lo importe, que es lo que lo convierte");
  console.log("en módulo. Este control no lleva lista de excepciones a propósito.");
}

process.exit(fallos === 0 ? 0 : 1);
