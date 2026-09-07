// Fails if any application code reads a table directly with the service-role
// client. Runs in seconds, needs no database, and works the same in every
// environment.
//
// WHY THIS EXISTS. Production revokes SELECT from `service_role` on the
// customer tables; the dev branch does not. So a direct table read through
// createServiceClient() works perfectly in dev and can never work in
// production. That is not hypothetical — on 2026-09-05 /admin returned 500 in
// production with `permission denied for table owners` for exactly this, and it
// had passed every check in dev.
//
// The obvious fix was to align dev's grants so dev would fail too. That turned
// out to be the wrong tool: the qa/ scripts legitimately read and write tables
// with that key, and they only ever run against dev, so tightening dev would
// have broken the test harness to catch a mistake in application code.
//
// This catches the same mistake at the source instead — in the diff, before it
// ships, in both environments, without breaking anything.
//
// THE ONE ALLOWED TABLE. `bcv_exchange_rate_fetches` is the exception, and it
// is a deliberate one: the exchange-rate cron writes there with no owner
// session, and production grants service_role INSERT and SELECT on it and
// nothing else. That grant is the specification; this list mirrors it.
//
// Everything else goes through a SECURITY DEFINER function, which needs no
// table grant at all. supabase/039_admin_reads_without_table_grants.sql is the
// worked example.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Application code only. qa/ and analytics/ are deliberately excluded: qa/ is
// dev-only tooling that provisions and mutates fixtures, and analytics/ now
// goes through lib/admin/metrics.ts like everything else.
const ROOTS = ["app", "lib", "components", "hooks"];
const ALLOWED_TABLES = new Set(["bcv_exchange_rate_fetches"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const offenders = [];
let filesChecked = 0;
let serviceRoleFiles = 0;

for (const root of ROOTS) {
  const dir = path.join(projectRoot, root);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  for (const file of walk(dir)) {
    filesChecked += 1;
    const src = readFileSync(file, "utf8");
    // The definition of the client itself is not a caller.
    if (!src.includes("createServiceClient") || file.endsWith(path.join("supabase", "service.ts"))) continue;
    serviceRoleFiles += 1;

    for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]/g)) {
      const table = m[1];
      if (ALLOWED_TABLES.has(table)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push({ file: path.relative(projectRoot, file), line, table });
    }
  }
}

console.log(`${filesChecked} archivos revisados · ${serviceRoleFiles} usan createServiceClient`);
console.log(`tablas permitidas: ${[...ALLOWED_TABLES].join(", ")}`);

if (offenders.length === 0) {
  console.log("\nPASS  ninguna lectura directa de tablas con service_role");
  process.exit(0);
}

console.log("\nFAIL  lectura directa de tabla con service_role:\n");
for (const o of offenders) {
  console.log(`  ${o.file}:${o.line}  ->  ${o.table}`);
}
console.log(
  "\nEsto funciona en dev y NO puede funcionar en producción, que le revoca\n" +
    "SELECT a service_role sobre las tablas de clientes. Muévelo detrás de una\n" +
    "función SECURITY DEFINER — ver supabase/039_admin_reads_without_table_grants.sql.",
);
process.exit(1);
