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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase";
const MIN_BYTES = 100;

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
}

console.log("");
if (failed === 0) {
  console.log(`ALL GREEN — ${checked} archivos .sql, todos con SQL dentro`);
} else {
  console.log(`FAILURES: ${failed} de ${checked}`);
  console.log("");
  console.log("Un archivo de migración vacío o pisado casi siempre se recupera con:");
  console.log("  git checkout -- supabase/<archivo>.sql");
  console.log("Comprueba antes que la versión de git es la buena: git show HEAD:supabase/<archivo>.sql | head");
}

process.exit(failed === 0 ? 0 : 1);
