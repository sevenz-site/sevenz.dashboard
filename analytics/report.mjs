// The full metric set in one run — one command to run before a board or
// investor meeting instead of six.
//
//   npm run metrics
//   npm run metrics -- --country VE
//   npm run metrics -- --owner <uuid>
//   npm run metrics -- --from 2026-08-01 --to 2026-09-01
//   npm run metrics -- --env .env.production
//
// EVERY FIGURE COMES FROM lib/admin/metrics.ts, the same module /admin renders
// from. That is the point of this file, and it changed on 2026-09-07.
//
// It used to read `owners`, `clients`, `client_flags`, `movements` and
// `client_summary` directly and aggregate them in JavaScript. Two consequences,
// both real:
//
//   1. It could not read production at all. Production revokes SELECT from
//      service_role on the customer tables (see supabase/schema.sql and
//      migration 039), so every one of those reads returned "permission
//      denied". The tool built to answer questions about the business could
//      only ever report on dev's test data.
//
//   2. It was a second implementation of the same business metrics. The money
//      table, the mala-paga counts and the plazo average were computed here in
//      JS and there in SQL, free to disagree. When they did, nothing would say
//      so — the CLI and the dashboard would simply print different numbers to
//      different people.
//
// Now both read the same SECURITY DEFINER functions, which need no table
// grants and therefore work in production. Where they disagree, they cannot:
// there is one implementation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const envFile = argOf("env") ?? ".env.local";
const country = argOf("country") ?? null;
const ownerId = argOf("owner") ?? null;
const from = argOf("from") ?? null;
const to = argOf("to") ?? null;

// Loaded into process.env rather than passed around, because
// createServiceClient() reads it from there — the same function the app uses,
// not a second client configured differently.
for (const raw of readFileSync(path.join(projectRoot, envFile), "utf8").split(/\r?\n/)) {
  if (!raw.includes("=") || raw.trimStart().startsWith("#")) continue;
  const i = raw.indexOf("=");
  process.env[raw.slice(0, i).trim()] = raw
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

// Imported after the env is in place. createServiceClient reads process.env
// when it is called rather than at import time, so a static import would also
// work — this is explicit so the ordering cannot be broken by accident later.
const { getCurrencySummary, getTotals, getAverageCreditScore, getOwnerOptions } = await import(
  "../lib/admin/metrics.ts"
);

const filters = { country, ownerId, from, to, currency: null };

const money = (n) =>
  Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const line = (s) => console.log(s);

const [summary, totals, score, owners] = await Promise.all([
  getCurrencySummary(filters),
  getTotals(filters),
  getAverageCreditScore(filters),
  getOwnerOptions(),
]);

line("");
line("SEVENZ — METRICAS DE PRODUCTO");
line(`project ${projectRef}  ·  ${envFile}`);
line(
  [country && `country=${country}`, ownerId && `owner=${ownerId}`, from && `from=${from}`, to && `to=${to}`]
    .filter(Boolean)
    .join("  ") || "sin filtros — todos los negocios, todo el histórico",
);

const movementsTotal = summary.reduce((s, r) => s + Number(r.movements_total), 0);

line("");
line("-- Volumen --");
line(`  Clientes creados            ${totals.clients_created}`);
line(`  Movimientos creados         ${movementsTotal}`);

line("");
line("-- Dinero, por moneda --");
line(
  "  " +
    "Moneda".padEnd(8) +
    "Cargos".padStart(8) +
    "Total".padStart(16) +
    "Promedio".padStart(14) +
    "Abonos".padStart(9) +
    "Total".padStart(16) +
    "Promedio".padStart(14),
);
for (const r of summary) {
  line(
    "  " +
      String(r.currency).padEnd(8) +
      String(r.charges_count).padStart(8) +
      money(r.charge_total).padStart(16) +
      (r.charge_average === null ? "—" : money(r.charge_average)).padStart(14) +
      String(r.payments_count).padStart(9) +
      money(r.payment_total).padStart(16) +
      (r.payment_average === null ? "—" : money(r.payment_average)).padStart(14),
  );
}
if (summary.length === 0) line("  (sin movimientos en el filtro)");

line("");
line("-- Malas pagas --");
line(`  Marcadas                    ${totals.mala_paga_labelled}`);
line(`  Desmarcadas                 ${totals.mala_paga_unlabelled}`);
line(`  Marcadas ahora mismo        ${totals.clients_flagged_now}`);

// Weighted by how many charges carry a plazo in each currency, not a mean of
// means: a currency with three charges must not pull the average as hard as one
// with three hundred.
const plazoRows = summary.filter((r) => r.plazo_average !== null && r.charges_with_plazo > 0);
const chargesWithPlazo = plazoRows.reduce((s, r) => s + Number(r.charges_with_plazo), 0);
const chargesTotal = summary.reduce((s, r) => s + Number(r.charges_count), 0);
const plazoAverage = chargesWithPlazo
  ? plazoRows.reduce((s, r) => s + Number(r.plazo_average) * Number(r.charges_with_plazo), 0) /
    chargesWithPlazo
  : null;

line("");
line("-- Plazo de pago --");
line(`  Promedio                    ${plazoAverage === null ? "—" : plazoAverage.toFixed(1) + " dias"}`);
line(`  Cargos con plazo            ${chargesWithPlazo} de ${chargesTotal}`);

line("");
line("-- Puntaje crediticio --");
line(
  `  Promedio                    ${score.average === null ? "—" : score.average + " de 1000"}  (${score.clients} clientes)`,
);

// One extra round trip per country rather than aggregating owner rows here.
// Computing it locally would put a third implementation of these same numbers
// in this file, which is the thing this rewrite exists to remove.
line("");
line("-- Por pais --");
for (const c of ["CO", "VE"]) {
  const [t, s] = await Promise.all([
    getTotals({ ...filters, country: c }),
    getCurrencySummary({ ...filters, country: c }),
  ]);
  const negocios = owners.filter((o) => o.country === c).length;
  const movimientos = s.reduce((acc, r) => acc + Number(r.movements_total), 0);
  line(
    `  ${c}  negocios ${String(negocios).padStart(3)}   clientes ${String(t.clients_created).padStart(4)}   movimientos ${String(movimientos).padStart(5)}`,
  );
}
line("");
