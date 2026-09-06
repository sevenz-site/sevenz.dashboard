// The full metric set in one run — the same figures analytics/metrics.sql
// produces, plus the credit-score average that SQL cannot reach, so there is
// one command to run before a board or investor meeting instead of six.
//
//   npm run metrics
//   npm run metrics -- --country VE
//   npm run metrics -- --owner <uuid>
//   npm run metrics -- --from 2026-08-01 --to 2026-09-01
//
// Reads .env.local, so it reports on whatever project that points at. For
// production numbers pass --env .env.production with production credentials in
// it; the header prints the project ref so a dev run can never be mistaken for
// a production one.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeCreditScore } from "../lib/credit-score.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? null : args[i + 1];
};

const envFile = argOf("env") ?? ".env.local";
const country = argOf("country");
const ownerId = argOf("owner");
const from = argOf("from");
const to = argOf("to");

const env = Object.fromEntries(
  readFileSync(path.join(projectRoot, envFile), "utf8")
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
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const [{ data: owners }, { data: clients }, { data: flags }] = await Promise.all([
  db.from("owners").select("id, business_name, country"),
  db.from("clients").select("id, owner_id, created_at, is_flagged"),
  db.from("client_flags").select("client_id, owner_id, flagged_at, unflagged_at"),
]);

// Paged deliberately: PostgREST caps a plain select at 1,000 rows, and a shop
// past that would be silently truncated — the same trap that made the
// dashboard's weekly chart show a fraction of the week.
async function allMovements() {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("movements")
      .select("id, client_id, type, amount, currency, plazo_dias, created_at")
      .is("deleted_at", null)
      .order("created_at")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const movements = await allMovements();

const ownerById = new Map(owners.map((o) => [o.id, o]));
const ownerOfClient = new Map(clients.map((c) => [c.id, c.owner_id]));
const keepOwner = (id) => {
  const o = ownerById.get(id);
  if (!o) return false;
  if (country && o.country !== country) return false;
  if (ownerId && o.id !== ownerId) return false;
  return true;
};
const inWindow = (iso) => (!from || iso >= from) && (!to || iso < to);

const scopedClients = clients.filter((c) => keepOwner(c.owner_id) && inWindow(c.created_at));
const scopedMovements = movements.filter(
  (m) => keepOwner(ownerOfClient.get(m.client_id)) && inWindow(m.created_at),
);
const scopedFlags = flags.filter((f) => keepOwner(f.owner_id));

const money = (n) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (a) => a.reduce((s, x) => s + Number(x.amount), 0);
const line = (s) => console.log(s);

line("");
line("SEVENZ — METRICAS DE PRODUCTO");
line(`project ${projectRef}  ·  ${envFile}`);
line(
  [country && `country=${country}`, ownerId && `owner=${ownerId}`, from && `from=${from}`, to && `to=${to}`]
    .filter(Boolean)
    .join("  ") || "sin filtros — todos los negocios, todo el histórico",
);

line("");
line("-- Volumen --");
line(`  Clientes creados            ${scopedClients.length}`);
line(`  Movimientos creados         ${scopedMovements.length}`);

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
const byCurrency = {};
for (const m of scopedMovements) {
  const key = m.currency ?? "COP";
  byCurrency[key] = byCurrency[key] ?? [];
  byCurrency[key].push(m);
}
for (const [cur, list] of Object.entries(byCurrency).sort()) {
  const ch = list.filter((x) => x.type === "charge");
  const pa = list.filter((x) => x.type === "payment");
  line(
    "  " +
      cur.padEnd(8) +
      String(ch.length).padStart(8) +
      money(sum(ch)).padStart(16) +
      (ch.length ? money(sum(ch) / ch.length) : "—").padStart(14) +
      String(pa.length).padStart(9) +
      money(sum(pa)).padStart(16) +
      (pa.length ? money(sum(pa) / pa.length) : "—").padStart(14),
  );
}
if (Object.keys(byCurrency).length === 0) line("  (sin movimientos en el filtro)");

line("");
line("-- Malas pagas --");
line(`  Marcadas                    ${scopedFlags.filter((f) => inWindow(f.flagged_at)).length}`);
line(
  `  Desmarcadas                 ${scopedFlags.filter((f) => f.unflagged_at && inWindow(f.unflagged_at)).length}`,
);
line(`  Marcadas ahora mismo        ${scopedClients.filter((c) => c.is_flagged).length}`);

const charges = scopedMovements.filter((m) => m.type === "charge");
const withPlazo = charges.filter((m) => m.plazo_dias != null);
line("");
line("-- Plazo de pago --");
line(
  `  Promedio                    ${withPlazo.length ? (withPlazo.reduce((s, m) => s + m.plazo_dias, 0) / withPlazo.length).toFixed(1) + " dias" : "—"}`,
);
line(`  Cargos con plazo            ${withPlazo.length} de ${charges.length}`);

// Credit score: the real implementation from lib/credit-score.ts, never a
// reimplementation — two copies of a scoring algorithm would drift, and the
// number an investor sees would stop matching the one an owner sees.
// Paged: PostgREST returns at most 1,000 rows and says nothing about the rest,
// so an unpaged read would quietly turn "every client" into "an arbitrary
// thousand" once the platform passes that mark.
async function allClientSummaries(db) {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db.from("client_summary").select("*").range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const summaries = await allClientSummaries(db);
const lastUnflagged = new Map();
for (const f of flags) {
  if (!f.unflagged_at) continue;
  const prev = lastUnflagged.get(f.client_id);
  if (!prev || new Date(f.unflagged_at) > new Date(prev)) lastUnflagged.set(f.client_id, f.unflagged_at);
}
const movesByClient = new Map();
for (const m of movements) {
  if (!movesByClient.has(m.client_id)) movesByClient.set(m.client_id, []);
  movesByClient.get(m.client_id).push(m);
}
const scopedIds = new Set(scopedClients.map((c) => c.id));
const scores = [];
for (const r of summaries.filter((x) => scopedIds.has(x.client_id))) {
  scores.push(
    computeCreditScore({
      movements: movesByClient.get(r.client_id) ?? [],
      balance: Number(r.balance ?? 0),
      daysSincePayment: Number(r.days_since_payment ?? 0),
      oldestUnpaidChargeAt: r.oldest_unpaid_charge_at ?? null,
      oldestUnpaidChargePlazoDias: r.oldest_unpaid_charge_plazo_dias ?? null,
      isFlagged: Boolean(r.is_flagged),
      mostRecentUnflaggedAt: lastUnflagged.get(r.client_id) ?? null,
    }).score,
  );
}
line("");
line("-- Puntaje crediticio --");
line(
  `  Promedio                    ${scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) + " de 1000" : "—"}  (${scores.length} clientes)`,
);

line("");
line("-- Por pais --");
for (const c of ["CO", "VE"]) {
  const ids = new Set(owners.filter((o) => o.country === c).map((o) => o.id));
  const cl = scopedClients.filter((x) => ids.has(x.owner_id));
  const mv = scopedMovements.filter((m) => ids.has(ownerOfClient.get(m.client_id)));
  line(
    `  ${c}  negocios ${String(ids.size).padStart(3)}   clientes ${String(cl.length).padStart(4)}   movimientos ${String(mv.length).padStart(5)}`,
  );
}
line("");
