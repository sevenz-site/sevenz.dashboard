// Every .sql file under supabase/ still contains SQL.
//
// Needs no database and no browser. It answers one question: has a migration
// file been emptied, truncated or overwritten by something that is not SQL?
//
// WHY THIS EXISTS. On 2026-09-18, supabase/064_client_feedback.sql went from
// 5994 bytes to 5: the word "listo", typed into an open editor instead of into
// a chat box, and saved. Nothing was lost — git still held the real file — but
// it sat that way through several commits, and any `git add -A` would have
// replaced the migration in history with one word. Worse, that file is exactly
// the one someone opens to paste into the Supabase SQL editor: the failure
// would have surfaced as a migration that "did nothing" in production.
//
// WHAT IT DELIBERATELY DOES NOT CHECK. Not whether a migration ends with the
// schema_migrations insert: 29 of the 66 numbered files predate migration 028,
// which is what created that ledger, so the check would fire 29 false alarms on
// day one. CLAUDE.md is explicit that an alarm which always rings stops being
// read — worse than no alarm, because it trains everyone to walk past it.
//
// The floor is 100 bytes. The smallest real migration in the repo is
// 004_onboarding.sql at 168, so there is room to spare and nothing to tune.
//
// AND THEN IT HAPPENED AGAIN, on 2026-09-28, in a way the two checks above do
// not see. The word "anotalo" was typed into the top of
// 071_whatsapp_cron_latido.sql and saved. The file kept all 6 KB of its SQL and
// every semicolon, so both checks passed and the run said ALL GREEN. It was
// found only because `git status` showed a file nobody had edited.
//
// A word ADDED is as broken as a file emptied: pasted into the SQL editor,
// `anotalo` on line 1 is a syntax error. With luck it fails loudly; without it,
// someone deletes the line by hand, says nothing, and the file in the repo
// stays broken for the next person.
//
// Hence the third check: the first line that is not blank must LOOK like SQL —
// a comment, or a statement keyword. It is deliberately a whitelist and not a
// blacklist of stray words: there is no list of the things a person might
// accidentally type, but there is a very short list of how a .sql file legally
// begins.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase";
const MIN_BYTES = 100;
// Cómo empieza legalmente un .sql de este repo. Lista blanca y no lista negra:
// no existe el catálogo de lo que alguien puede teclear por error, pero sí el
// de las formas válidas de abrir un archivo.
const EMPIEZOS =
  /^(begin|commit|create|alter|insert|update|delete|drop|grant|revoke|set|do|with|comment|select|truncate|analyze|vacuum)\b/i;

let failed = 0;
let checked = 0;

for (const name of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const path = join(DIR, name);
  const bytes = statSync(path).size;
  const body = readFileSync(path, "utf8");
  checked++;

  // Two independent ways of being broken. Size catches a clobber or a
  // truncated save; the semicolon catches a file that is the right length and
  // still is not SQL — a pasted paragraph, a merge conflict left unresolved.
  if (bytes < MIN_BYTES) {
    console.log(`FAIL  ${name} — ${bytes} bytes, por debajo del mínimo de ${MIN_BYTES}`);
    failed++;
    continue;
  }
  if (!body.includes(";")) {
    console.log(`FAIL  ${name} — ${bytes} bytes pero sin una sola sentencia SQL`);
    failed++;
    continue;
  }

  // La tercera: que EMPIECE como SQL. Un archivo intacto al que le han
  // prependido una palabra pasa las dos de arriba — conserva su tamaño y sus
  // puntos y coma — y revienta al pegarlo en el editor.
  const primera = body.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  const empiezaComoSql =
    primera.startsWith("--") ||
    primera.startsWith("/*") ||
    EMPIEZOS.test(primera);
  if (!empiezaComoSql) {
    console.log(
      `FAIL  ${name} — la primera línea no parece SQL: ${JSON.stringify(primera.slice(0, 40))}`,
    );
    failed++;
    continue;
  }
}

console.log("");
if (failed === 0) {
  console.log(`ALL GREEN — ${checked} archivos .sql, todos con SQL dentro`);
} else {
  console.log(`FAILURES: ${failed} de ${checked}`);
  console.log("");
  console.log("Si la primera línea no parece SQL, mira si es una palabra suelta");
  console.log("escrita por error: pasó el 2026-09-18 y el 2026-09-28. Quítala y ya.");
  console.log("");
  console.log("Un archivo de migración vacío o pisado casi siempre se recupera con:");
  console.log("  git checkout -- supabase/<archivo>.sql");
  console.log("Comprueba antes que la versión de git es la buena: git show HEAD:supabase/<archivo>.sql | head");
}

process.exit(failed === 0 ? 0 : 1);
