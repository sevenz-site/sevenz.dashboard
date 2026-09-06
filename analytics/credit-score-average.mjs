// Average "Puntaje crediticio" across clients.
//
// This one metric cannot come from SQL. The score is ~200 lines of weighted
// TypeScript in lib/credit-score.ts (lifetime punctuality 35%, current standing
// 30%, recent trend 20%, tenure 15%) and is computed at render time, never
// stored. Reimplementing it in PL/pgSQL would leave two versions of the same
// algorithm free to drift, and the number an investor is shown would slowly
// stop matching the number an owner sees on their own screen.
//
// So this reuses the real implementation instead of copying it.
//
// Usage — the --import path is resolved by the shell, so run this from the
// dashboard/ directory (everything else here is cwd-independent):
//   cd .../Sevenz/dashboard
//   node --experimental-strip-types --import ./analytics/register-hooks.mjs analytics/credit-score-average.mjs
//   ... --country VE
//   ... --owner <uuid>
//
// Reads .env.local for the service-role key, so it sees every owner's clients.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCreditScore } from "../lib/credit-score.ts";

// Resolved from this file, not the shell's working directory. Running it from
// the wrong folder otherwise fails on .env.local with an error that points at
// modules rather than at the actual mistake.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const filterCountry = argOf("country");
const filterOwner = argOf("owner");

const env = Object.fromEntries(
  readFileSync(path.join(projectRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let ownersQuery = db.from("owners").select("id, business_name, country");
if (filterCountry) ownersQuery = ownersQuery.eq("country", filterCountry);
if (filterOwner) ownersQuery = ownersQuery.eq("id", filterOwner);
const { data: owners, error: ownersError } = await ownersQuery;
if (ownersError) throw ownersError;

// client_summary already carries the balance and payment recency the score
// needs, so this reads the same inputs the app itself passes in.
const { data: summaries } = await db.from("client_summary").select("*");
const { data: flags } = await db.from("client_flags").select("client_id, unflagged_at");

const lastUnflagged = new Map();
for (const f of flags ?? []) {
  if (!f.unflagged_at) continue;
  const prev = lastUnflagged.get(f.client_id);
  if (!prev || new Date(f.unflagged_at) > new Date(prev)) lastUnflagged.set(f.client_id, f.unflagged_at);
}

const ownerIds = new Set(owners.map((o) => o.id));
const rows = (summaries ?? []).filter((r) => ownerIds.has(r.owner_id));

const scores = [];
const byCountry = new Map();
for (const r of rows) {
  const { data: movements } = await db
    .from("movements")
    .select("id, type, amount, currency, plazo_dias, created_at")
    .eq("client_id", r.client_id)
    .is("deleted_at", null)
    .order("created_at");

  const result = computeCreditScore({
    movements: movements ?? [],
    balance: Number(r.balance ?? 0),
    daysSincePayment: Number(r.days_since_payment ?? 0),
    oldestUnpaidChargeAt: r.oldest_unpaid_charge_at ?? null,
    oldestUnpaidChargePlazoDias: r.oldest_unpaid_charge_plazo_dias ?? null,
    isFlagged: Boolean(r.is_flagged),
    mostRecentUnflaggedAt: lastUnflagged.get(r.client_id) ?? null,
  });
  scores.push(result.score);
  const country = owners.find((o) => o.id === r.owner_id)?.country ?? "?";
  if (!byCountry.has(country)) byCountry.set(country, []);
  byCountry.get(country).push(result.score);
}

const avg = (a) => (a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : null);
const filters = [filterCountry && `country=${filterCountry}`, filterOwner && `owner=${filterOwner}`]
  .filter(Boolean)
  .join(" ");

console.log(`Puntaje crediticio${filters ? ` (${filters})` : ""}`);
console.log(`  clients scored : ${scores.length}`);
console.log(`  average        : ${avg(scores) ?? "n/a"} de 1000`);
for (const [country, list] of [...byCountry].sort()) {
  console.log(`  ${country.padEnd(15)}: ${avg(list)} de 1000  (${list.length} clients)`);
}
