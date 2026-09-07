// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// Verifies migration 047: the six admin metric functions now take
// `p_owners uuid[]` instead of a single `p_owner`.
//
// Three properties, and the third is the one worth writing a script for:
//
//   1. The old signature is GONE. A dropped-and-recreated function is the one
//      migration shape that can leave both versions installed — Postgres
//      overloads on argument types, so `drop ... (text, uuid, ...)` failing
//      silently would leave the app calling whichever PostgREST resolved
//      first. Calling with the old parameter name must error.
//
//   2. null and [] are the same query. Deselecting the last business is a
//      person clearing the filter, and answering that with zeros would look
//      exactly like data loss.
//
//   3. Two owners == the two one-owner runs combined. This is what makes it a
//      segmentation tool rather than a filter that happens to accept a list.
//      Compared against real dev data, not a fixture, so it exercises the
//      `= any(p_owners)` clause in every function including the ones whose
//      filter sits inside a CTE.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (projectRef !== DEV_REF) {
  console.error(`REFUSING TO RUN. .env.local points at "${projectRef}", not the dev branch (${DEV_REF}).`);
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data ?? [];
}

const num = (v) => Math.round(Number(v ?? 0) * 100) / 100;

// ── 0. the owners to segment by ─────────────────────────────────────────
const owners = await rpc("admin_owner_options", {});
check("admin_owner_options devuelve negocios", owners.length >= 2, `${owners.length} negocios`);
if (owners.length < 2) {
  console.error("\nSe necesitan al menos 2 negocios en dev para probar la segmentación.");
  process.exit(1);
}

// The two with the most movements, so the comparison is over real rows rather
// than two empty shops that would pass by both being zero.
const ranked = await rpc("admin_metrics_by_owner", {});
const busiest = [...ranked].sort((a, b) => Number(b.movements) - Number(a.movements)).slice(0, 2);
const [A, B] = busiest.map((o) => o.owner_id);
check(
  "hay dos negocios con movimientos para comparar",
  Number(busiest[0]?.movements ?? 0) > 0,
  busiest.map((o) => `${o.business_name || "(sin nombre)"}: ${o.movements} mov`).join(" · "),
);

// ── 1. the single-uuid signature is gone ────────────────────────────────
{
  const { error } = await db.rpc("admin_metrics_totals", { p_owner: A });
  check(
    "la firma antigua p_owner ya no existe",
    Boolean(error),
    error ? error.message.slice(0, 90) : "LA FUNCIÓN VIEJA SIGUE INSTALADA",
  );
}

// ── 2. null === [] for all six functions ────────────────────────────────
const SIX = [
  ["admin_metrics_summary", {}],
  ["admin_metrics_totals", {}],
  ["admin_metrics_timeseries", { p_bucket: "month" }],
  ["admin_metrics_by_owner", {}],
  ["admin_credit_inputs", {}],
  ["admin_credit_movements", {}],
];

for (const [fn, extra] of SIX) {
  const asNull = await rpc(fn, { ...extra, p_owners: null });
  const asEmpty = await rpc(fn, { ...extra, p_owners: [] });
  check(
    `${fn}: [] se comporta como null`,
    JSON.stringify(asNull) === JSON.stringify(asEmpty),
    `${asNull.length} filas vs ${asEmpty.length}`,
  );
}

// ── 3. two owners == the two single-owner runs combined ─────────────────
{
  const one = await rpc("admin_metrics_totals", { p_owners: [A] });
  const two = await rpc("admin_metrics_totals", { p_owners: [B] });
  const both = await rpc("admin_metrics_totals", { p_owners: [A, B] });
  const r = (x) => (Array.isArray(x) ? x[0] : x) ?? {};
  const [a, b, ab] = [r(one), r(two), r(both)];
  const keys = ["clients_created", "clients_flagged_now", "mala_paga_labelled", "mala_paga_unlabelled"];
  const bad = keys.filter((k) => Number(a[k]) + Number(b[k]) !== Number(ab[k]));
  check(
    "admin_metrics_totals: A + B === [A, B]",
    bad.length === 0,
    bad.length === 0
      ? keys.map((k) => `${k}=${ab[k]}`).join(" · ")
      : bad.map((k) => `${k}: ${a[k]}+${b[k]} ≠ ${ab[k]}`).join(" · "),
  );
}

{
  // Per currency, because a CO ledger is COP and a VE one is USD or EUR, and
  // these amounts are never summed across currencies anywhere in the product.
  const sumByCurrency = (rows) =>
    rows.reduce((m, r) => m.set(r.currency, num((m.get(r.currency) ?? 0) + Number(r.charge_total))), new Map());
  const one = sumByCurrency(await rpc("admin_metrics_summary", { p_owners: [A] }));
  const two = sumByCurrency(await rpc("admin_metrics_summary", { p_owners: [B] }));
  const both = sumByCurrency(await rpc("admin_metrics_summary", { p_owners: [A, B] }));
  const currencies = new Set([...one.keys(), ...two.keys(), ...both.keys()]);
  const bad = [...currencies].filter(
    (c) => num((one.get(c) ?? 0) + (two.get(c) ?? 0)) !== num(both.get(c) ?? 0),
  );
  check(
    "admin_metrics_summary: total fiado por moneda suma",
    bad.length === 0,
    bad.length === 0
      ? [...currencies].map((c) => `${c ?? "COP"}=${both.get(c) ?? 0}`).join(" · ")
      : bad.map((c) => `${c}: ${one.get(c) ?? 0}+${two.get(c) ?? 0} ≠ ${both.get(c) ?? 0}`).join(" · "),
  );
}

{
  // The breakdown gained the filter it never had. Selecting two businesses
  // must return exactly those two rows — this is the whole point of the change.
  const rows = await rpc("admin_metrics_by_owner", { p_owners: [A, B] });
  const ids = rows.map((r) => r.owner_id).sort();
  check(
    "admin_metrics_by_owner: respeta el filtro (2 negocios → 2 filas)",
    rows.length === 2 && JSON.stringify(ids) === JSON.stringify([A, B].sort()),
    `${rows.length} filas`,
  );

  const all = await rpc("admin_metrics_by_owner", { p_owners: null });
  check(
    "admin_metrics_by_owner: sin filtro sigue devolviendo todos",
    all.length === owners.length,
    `${all.length} de ${owners.length}`,
  );
}

{
  // The credit-score path, which pages through PostgREST's 1000-row cap in
  // lib/admin/metrics.ts. Here it only has to prove the filter partitions.
  const one = await rpc("admin_credit_inputs", { p_owners: [A] });
  const two = await rpc("admin_credit_inputs", { p_owners: [B] });
  const both = await rpc("admin_credit_inputs", { p_owners: [A, B] });
  check(
    "admin_credit_inputs: A + B === [A, B]",
    one.length + two.length === both.length,
    `${one.length} + ${two.length} = ${both.length}`,
  );

  const ids = new Set(both.map((r) => r.client_id));
  const movements = await rpc("admin_credit_movements", { p_owners: [A, B] });
  check(
    "admin_credit_movements: ningún movimiento fuera del segmento",
    movements.every((m) => ids.has(m.client_id)),
    `${movements.length} movimientos de ${ids.size} clientes`,
  );
}

// ── 4. timeseries, whose filter sits inside CTEs ────────────────────────
{
  const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const one = await rpc("admin_metrics_timeseries", { p_bucket: "month", p_owners: [A] });
  const two = await rpc("admin_metrics_timeseries", { p_bucket: "month", p_owners: [B] });
  const both = await rpc("admin_metrics_timeseries", { p_bucket: "month", p_owners: [A, B] });
  const bad = ["movements", "charges", "payments", "clients_created"].filter(
    (k) => sum(one, k) + sum(two, k) !== sum(both, k),
  );
  check(
    "admin_metrics_timeseries: A + B === [A, B]",
    bad.length === 0,
    bad.length === 0
      ? `${sum(both, "movements")} movimientos en ${both.length} buckets`
      : bad.map((k) => `${k}: ${sum(one, k)}+${sum(two, k)} ≠ ${sum(both, k)}`).join(" · "),
  );
}

// ── 5. an owner session still cannot call any of them ───────────────────
// 047 drops and recreates the functions, and a dropped function takes its ACL
// with it. If a grant line were missed, EXECUTE would fall back to PUBLIC and
// every owner could read the whole platform's numbers.
{
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const denied = [];
  for (const [fn, extra] of SIX) {
    const { error } = await anon.rpc(fn, { ...extra, p_owners: null });
    if (error) denied.push(fn);
  }
  check(
    "anon no puede ejecutar ninguna de las seis",
    denied.length === SIX.length,
    `${denied.length}/${SIX.length} denegadas`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
