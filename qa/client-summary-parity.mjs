// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// Migration 044 turned client_summary into a filtered view. Every screen in
// the app reads it, so the acceptance criterion from PAPELERA-PLAN.md phase 1
// is blunt: with nothing hidden, every figure must be byte-identical to what
// the unfiltered query returns. This asserts that against all of dev's real
// data, not a fixture.
//
// It also covers the two things the QA checklist calls high-risk on any
// release touching dashboard/actions.ts or import/actions.ts: that no movement
// ends up with a null currency under a VE owner, and that the per-currency
// balances the dashboard prints actually equal the ledger underneath them.
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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// PostgREST caps a plain select at 1000 rows and truncates SILENTLY. This
// project has been bitten by that repeatedly, and a parity check that only
// compared the first 1000 rows would be the worst possible place for it.
async function all(table, select) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

// ── 1. client_summary === client_summary_all, for every visible client ──
const filtered = await all("client_summary", "*");
const unfiltered = await all("client_summary_all", "*");
const visibleUnfiltered = unfiltered.filter((r) => r.trashed_at === null && r.deleted_at === null);

check(
  "same number of visible clients in both views",
  filtered.length === visibleUnfiltered.length,
  `client_summary ${filtered.length}, client_summary_all visible ${visibleUnfiltered.length}, hidden ${unfiltered.length - visibleUnfiltered.length}`,
);

// Compare every shared column, not just the balances — days_since_payment and
// oldest_unpaid_charge_* drive status and mora, and a wrong one there is just
// as visible to an owner as a wrong number.
const SHARED_COLUMNS = Object.keys(filtered[0] ?? {}).filter(
  (k) => !k.startsWith("trashed_") && k !== "deleted_at",
);
const byId = new Map(visibleUnfiltered.map((r) => [r.client_id, r]));
const mismatches = [];
for (const row of filtered) {
  const other = byId.get(row.client_id);
  if (!other) {
    mismatches.push(`${row.client_id}: missing from client_summary_all`);
    continue;
  }
  for (const col of SHARED_COLUMNS) {
    if (JSON.stringify(row[col]) !== JSON.stringify(other[col])) {
      mismatches.push(`${row.name} .${col}: ${JSON.stringify(row[col])} vs ${JSON.stringify(other[col])}`);
    }
  }
}
check(
  "every visible client is byte-identical across both views",
  mismatches.length === 0,
  mismatches.length === 0
    ? `${filtered.length} clients x ${SHARED_COLUMNS.length} columns`
    : mismatches.slice(0, 5).join(" | "),
);

// ── 2. no movement is missing its currency under a VE owner ─────────────
const owners = await all("owners", "id, country, business_name");
const veOwnerIds = new Set(owners.filter((o) => o.country === "VE").map((o) => o.id));
const clients = await all("clients", "id, owner_id, name");
const clientOwner = new Map(clients.map((c) => [c.id, c.owner_id]));
const movements = await all("movements", "id, client_id, type, amount, currency, running_balance, deleted_at");

const veNullCurrency = movements.filter(
  (m) => m.deleted_at === null && veOwnerIds.has(clientOwner.get(m.client_id)) && m.currency === null,
);
check(
  "no live movement under a VE owner has a null currency",
  veNullCurrency.length === 0,
  veNullCurrency.length === 0
    ? `${movements.filter((m) => m.deleted_at === null).length} live movements checked, ${veOwnerIds.size} VE owners`
    : `${veNullCurrency.length} offenders, first ${veNullCurrency[0].id}`,
);

// ── 3. the printed balances equal the ledger underneath them ────────────
// Recomputed from the movements themselves rather than trusting
// running_balance, so a broken recalc_client_running_balance shows up here.
const ledgerMismatches = [];
for (const row of unfiltered) {
  const mine = movements.filter((m) => m.client_id === row.client_id && m.deleted_at === null);
  const total = (currency) =>
    mine
      .filter((m) => (currency === null ? m.currency === null : m.currency === currency))
      .reduce((t, m) => t + (m.type === "charge" ? Number(m.amount) : -Number(m.amount)), 0);
  const pairs = [
    ["balance", total(null)],
    ["balance_usd", total("USD")],
    ["balance_eur", total("EUR")],
  ];
  for (const [col, expected] of pairs) {
    if (Math.abs(Number(row[col]) - expected) > 0.0001) {
      ledgerMismatches.push(`${row.name} .${col}: view ${row[col]} vs movements ${expected}`);
    }
  }
}
check(
  "per-currency balances match the sum of their own movements",
  ledgerMismatches.length === 0,
  ledgerMismatches.length === 0
    ? `${unfiltered.length} clients, 3 currencies each`
    : ledgerMismatches.slice(0, 5).join(" | "),
);

// ── 4. the public page's contract, for a CO and a VE client ─────────────
// Every field app/s/[token]/page.tsx reads off the RPC's result. document_id
// is deliberately absent since 043 — the page falls back to has_document_id.
const PAGE_READS = [
  "balance",
  "balance_eur",
  "balance_usd",
  "business_name",
  "client_name",
  "current_bcv_eur",
  "current_bcv_usd",
  "custom_rate_eur",
  "custom_rate_usd",
  "has_document_id",
  "movement_total",
  "movements",
  "owner_country",
  "owner_logo_path",
  "owner_whatsapp",
  "rate_mode",
  "whatsapp_last4",
];

const links = await all("share_links", "token, client_id");
async function shapeFor(country) {
  const link = links.find((l) => {
    const ownerId = clientOwner.get(l.client_id);
    const owner = owners.find((o) => o.id === ownerId);
    return owner?.country === country;
  });
  if (!link) return { link: null };
  const { data, error } = await anon.rpc("get_shared_balance", { p_token: link.token });
  return { link, data, error };
}

for (const country of ["CO", "VE"]) {
  const { link, data, error } = await shapeFor(country);
  if (!link) {
    check(`public page contract, ${country} client`, false, "no share link found for this country in dev");
    continue;
  }
  const missing = PAGE_READS.filter((k) => !(k in (data ?? {})));
  check(
    `public page contract, ${country} client`,
    !error && missing.length === 0,
    error ? error.message : missing.length ? `missing: ${missing.join(", ")}` : "all 17 fields present",
  );
  // 043 removed these two and they must stay removed.
  check(
    `public page leaks neither document nor payment details, ${country}`,
    !("document_id" in (data ?? {})) && !("payment_info" in (data ?? {})),
    Object.keys(data ?? {}).filter((k) => k === "document_id" || k === "payment_info").join(",") || "neither present",
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
