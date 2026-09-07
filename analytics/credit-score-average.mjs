// Average "Puntaje crediticio" across clients, with a per-country breakdown.
//
// This one metric cannot come from SQL. The score is ~200 lines of weighted
// TypeScript in lib/credit-score.ts (lifetime punctuality 35%, current standing
// 30%, recent trend 20%, tenure 15%) and is computed at render time, never
// stored. Reimplementing it in PL/pgSQL would leave two versions of the same
// algorithm free to drift, and the number an investor is shown would slowly
// stop matching the number an owner sees on their own screen.
//
// So this reuses the real implementation, through lib/admin/metrics.ts — the
// same module /admin renders from. It used to read `owners`, `client_summary`,
// `client_flags` and `movements` directly, which meant it could not run against
// production at all: production revokes SELECT from service_role on those
// tables (migration 039), so every read came back "permission denied". The
// SECURITY DEFINER functions behind getAverageCreditScore need no table grant
// and work in both environments.
//
// Usage — the --import path is resolved by the shell, so run this from the
// dashboard/ directory (everything else here is cwd-independent):
//   npm run metrics:credit-score
//   npm run metrics:credit-score -- --country VE
//   npm run metrics:credit-score -- --owner <uuid>
//   npm run metrics:credit-score -- --env .env.production
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file, not the shell's working directory. Running it from
// the wrong folder otherwise fails on .env.local with an error that points at
// modules rather than at the actual mistake.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const envFile = argOf("env") ?? ".env.local";
const filterCountry = argOf("country") ?? null;
const filterOwner = argOf("owner") ?? null;

for (const raw of readFileSync(path.join(projectRoot, envFile), "utf8").split(/\r?\n/)) {
  if (!raw.includes("=") || raw.trimStart().startsWith("#")) continue;
  const i = raw.indexOf("=");
  process.env[raw.slice(0, i).trim()] = raw
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const { getAverageCreditScore } = await import("../lib/admin/metrics.ts");

const filters = [filterCountry && `country=${filterCountry}`, filterOwner && `owner=${filterOwner}`]
  .filter(Boolean)
  .join(" ");

const overall = await getAverageCreditScore({
  country: filterCountry,
  ownerId: filterOwner,
  from: null,
  to: null,
});

console.log(`Puntaje crediticio${filters ? ` (${filters})` : ""}`);
console.log(`  clients scored : ${overall.clients}`);
console.log(`  average        : ${overall.average ?? "n/a"} de 1000`);

// Asked per country rather than grouped locally. Grouping here would mean
// re-deriving which owner each client belongs to, which is a second answer to a
// question the function already answers — and the kind of duplicate that only
// shows itself when the two stop agreeing.
if (!filterCountry) {
  for (const c of ["CO", "VE"]) {
    const r = await getAverageCreditScore({ country: c, ownerId: filterOwner, from: null, to: null });
    if (r.clients === 0) continue;
    console.log(`  ${c.padEnd(15)}: ${r.average} de 1000  (${r.clients} clients)`);
  }
}
