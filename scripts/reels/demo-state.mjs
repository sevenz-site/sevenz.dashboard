// Snapshot and exact restore of the DEV demo business, around recordings that save.
//
//   node scripts/reels/demo-state.mjs snapshot <name>
//   node scripts/reels/demo-state.mjs restore <name>     (then diffs again; exits 1 if anything is left)
//   node scripts/reels/demo-state.mjs diff <name>
//
// Owner's decision of 2026-11-27: the Reels flows save on the demo («Mini abasto El
// Chino») and everything they change is put back afterwards. seed-demo.mjs is NOT the
// way back: it rebuilds the demo from scratch with new ids, which would also wipe what
// the Ayuda scripts left on purpose. This undoes exactly what changed since the snapshot:
// new rows are deleted (children first), changed rows get their old values back, missing
// rows are re-inserted, new Storage files under the owner's folder are removed.
//
// DEV ONLY, demo owner only. It runs as the service role, which the ledger guards of
// migrations 180 and 188 let through (they apply to `authenticated` writes).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = join(HERE, "..", "..");
const [CMD, NAME] = process.argv.slice(2);
if (!["snapshot", "restore", "diff"].includes(CMD) || !NAME) throw new Error("Usage: demo-state.mjs snapshot|restore|diff <name>");
const { createClient } = createRequire(join(DASH, "package.json"))("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(join(DASH, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] !== "vzqppwrwnmlbrxizskdh") throw new Error("Dev only.");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OWNER = JSON.parse(readFileSync(join(DASH, "scripts", "ayuda", "demo-manifest.json"), "utf8")).ownerId;
const FILE = join(DASH, "output", "reels", "work", "_state", `${NAME}.json`);

// Every table that can hold something of the demo owner, and how to find it. `by` is the
// column filtered on; `from` names the parent table whose ids feed that column. Order is
// parents first; deletes run in reverse.
const TABLES = [
  { t: "owners", by: "id", owner: true },
  { t: "owner_exchange_settings", by: "owner_id", owner: true },
  { t: "owner_payment_methods", by: "owner_id", owner: true },
  { t: "owner_security_state", by: "owner_id", owner: true },
  { t: "owner_security_audit", by: "owner_id", owner: true },
  { t: "owner_devices", by: "owner_id", owner: true },
  { t: "owner_device_places", by: "owner_id", owner: true },
  { t: "owner_login_codes", by: "owner_id", owner: true },
  { t: "owner_security_tokens", by: "owner_id", owner: true },
  { t: "report_assistant_notes", by: "owner_id", owner: true },
  { t: "inactivity_nudges", by: "owner_id", owner: true },
  { t: "import_notifications", by: "owner_id", owner: true },
  { t: "catalog_share_links", by: "owner_id", owner: true },
  { t: "product_categories", by: "owner_id", owner: true },
  { t: "products", by: "owner_id", owner: true },
  { t: "product_barcodes", by: "owner_id", owner: true },
  { t: "product_hides", by: "owner_id", owner: true },
  { t: "stock_alerts", by: "owner_id", owner: true },
  { t: "product_price_overrides", by: "product_id", from: "products" },
  { t: "product_photos", by: "product_id", from: "products" },
  { t: "product_currencies", by: "product_id", from: "products" },
  { t: "clients", by: "owner_id", owner: true },
  { t: "client_flags", by: "owner_id", owner: true },
  { t: "client_hides", by: "owner_id", owner: true },
  { t: "share_links", by: "client_id", from: "clients" },
  { t: "link_opens", by: "client_id", from: "clients" },
  { t: "client_feedback", by: "client_id", from: "clients" },
  { t: "client_whatsapp_consents", by: "via_client_id", from: "clients" },
  { t: "catalog_orders", by: "owner_id", owner: true },
  { t: "catalog_order_items", by: "order_id", from: "catalog_orders" },
  { t: "sales", by: "owner_id", owner: true },
  { t: "sale_lines", by: "sale_id", from: "sales" },
  { t: "sale_payments", by: "sale_id", from: "sales" },
  { t: "movements", by: "client_id", from: "clients" },
  { t: "sale_returns", by: "owner_id", owner: true },
  { t: "movement_deletions", by: "owner_id", owner: true },
  { t: "movement_rejections", by: "owner_id", owner: true },
  { t: "ledger_rule_hits", by: "owner_id", owner: true },
  { t: "whatsapp_sends", by: "owner_id", owner: true },
  { t: "whatsapp_attention_memory", by: "owner_id", owner: true },
  { t: "whatsapp_attention_item_memory", by: "owner_id", owner: true },
];
const UNREADABLE = new Set();

async function selectAll(t, col, values) {
  const out = [];
  const chunks = [];
  for (let i = 0; i < values.length; i += 80) chunks.push(values.slice(i, i + 80));
  for (const c of chunks) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").in(col, c).range(from, from + 999);
      // A few tables grant the service role nothing (reached only through their own
      // functions). They are reported, not guessed at.
      if (error && /permission denied/.test(error.message)) { UNREADABLE.add(t); return []; }
      if (error) throw new Error(`${t}: ${error.message}`);
      out.push(...data);
      if (data.length < 1000) break;
    }
  }
  return out;
}

async function listFiles(bucket, prefix) {
  const out = [];
  const walk = async (p) => {
    const { data, error } = await db.storage.from(bucket).list(p, { limit: 1000 });
    if (error) return;
    for (const f of data) {
      const path = p ? `${p}/${f.name}` : f.name;
      if (f.id === null) await walk(path); else out.push(path);
    }
  };
  await walk(prefix);
  return out;
}

async function capture() {
  const snap = { owner: OWNER, at: new Date().toISOString(), tables: {}, files: {} };
  const ids = {};
  for (const d of TABLES) {
    const values = d.owner ? [OWNER] : (ids[d.from] ?? []);
    const rows = values.length ? await selectAll(d.t, d.by, values) : [];
    snap.tables[d.t] = rows;
    if (rows[0] && "id" in rows[0]) ids[d.t] = rows.map((r) => r.id);
  }
  const { data: buckets } = await db.storage.listBuckets();
  for (const b of (buckets ?? []).map((x) => x.id)) snap.files[b] = await listFiles(b, OWNER);
  if (UNREADABLE.size) console.log(`  (sin acceso con la llave de servicio, no se comparan: ${[...UNREADABLE].join(", ")})`);
  return snap;
}

const keyOf = (r) => ("id" in r ? `id:${r.id}` : JSON.stringify(Object.entries(r).sort()));
// `updated_at` is stamped by a trigger on every update, the restore's own included, so it
// can never go back to its old value and is not part of «the same row».
const comparable = (r) => Object.entries(r).filter(([k]) => k !== "updated_at").sort();
const same = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

function diff(before, now) {
  const out = [];
  for (const d of TABLES) {
    const a = new Map((before.tables[d.t] ?? []).map((r) => [keyOf(r), r]));
    const b = new Map((now.tables[d.t] ?? []).map((r) => [keyOf(r), r]));
    for (const [k, r] of b) if (!a.has(k)) out.push({ t: d.t, kind: "new", row: r });
    for (const [k, r] of a) {
      if (!b.has(k)) out.push({ t: d.t, kind: "gone", row: r });
      else if (!same(r, b.get(k))) out.push({ t: d.t, kind: "changed", row: r, now: b.get(k) });
    }
  }
  for (const [bucket, files] of Object.entries(now.files)) {
    const old = new Set(before.files[bucket] ?? []);
    for (const f of files) if (!old.has(f)) out.push({ t: `storage:${bucket}`, kind: "new", path: f });
  }
  return out;
}

function eqAll(q, row) {
  for (const [c, v] of Object.entries(row)) {
    if (v === null) q = q.is(c, null);
    else if (typeof v === "object") continue; // jsonb and arrays: the other columns already pin the row
    else q = q.eq(c, v);
  }
  return q;
}

async function restore(before) {
  const now = await capture();
  const changes = diff(before, now);
  const order = TABLES.map((d) => d.t);
  // 1. New rows: delete, children first. Movements newest first, so a row pointing at
  //    another new row (applies_to_movement_id) goes before it.
  const news = changes.filter((c) => c.kind === "new" && !c.t.startsWith("storage:"))
    .sort((x, y) => order.indexOf(y.t) - order.indexOf(x.t) || String(y.row.created_at ?? "").localeCompare(String(x.row.created_at ?? "")));
  let pending = news;
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const failed = [];
    for (const c of pending) {
      const q = "id" in c.row ? db.from(c.t).delete().eq("id", c.row.id) : eqAll(db.from(c.t).delete(), c.row);
      const { error } = await q;
      if (error) failed.push({ ...c, error: error.message });
    }
    pending = failed;
  }
  for (const f of pending) console.log(`  ✖ no se pudo borrar ${f.t} ${f.row.id ?? ""}: ${f.error}`);
  // 2. Changed rows: back to their old values, parents first.
  for (const c of changes.filter((c) => c.kind === "changed").sort((x, y) => order.indexOf(x.t) - order.indexOf(y.t))) {
    // Generated columns (products.name_search) refuse any value: drop each one Postgres
    // names and try again. They recompute from the columns that do go back.
    const row = { ...c.row };
    let error;
    for (let i = 0; i < 6; i++) {
      ({ error } = "id" in row
        ? await db.from(c.t).update(row).eq("id", row.id)
        : await eqAll(db.from(c.t).update(row), c.now));
      const gen = error?.message.match(/column "(\w+)" can only be updated to DEFAULT/);
      if (!gen) break;
      delete row[gen[1]];
    }
    if (error) console.log(`  ✖ no se pudo restaurar ${c.t} ${c.row.id ?? ""}: ${error.message}`);
  }
  // 3. Rows that disappeared: back in, parents first.
  for (const c of changes.filter((c) => c.kind === "gone").sort((x, y) => order.indexOf(x.t) - order.indexOf(y.t))) {
    const { error } = await db.from(c.t).insert(c.row);
    if (error) console.log(`  ✖ no se pudo reinsertar ${c.t} ${c.row.id ?? ""}: ${error.message}`);
  }
  // 4. New files.
  for (const c of changes.filter((c) => c.t.startsWith("storage:"))) {
    const { error } = await db.storage.from(c.t.slice(8)).remove([c.path]);
    if (error) console.log(`  ✖ no se pudo borrar el archivo ${c.path}: ${error.message}`);
  }
  const summary = {};
  for (const c of changes) summary[`${c.t} ${c.kind}`] = (summary[`${c.t} ${c.kind}`] ?? 0) + 1;
  return summary;
}

if (CMD === "snapshot") {
  const snap = await capture();
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(snap));
  const n = Object.values(snap.tables).reduce((a, r) => a + r.length, 0);
  console.log(`snapshot «${NAME}»: ${n} filas, ${Object.values(snap.files).flat().length} archivos`);
} else {
  if (!existsSync(FILE)) throw new Error(`No snapshot «${NAME}»`);
  const before = JSON.parse(readFileSync(FILE, "utf8"));
  if (before.owner !== OWNER) throw new Error("The snapshot is of another demo owner.");
  // Up to three passes: a delete can fire a trigger that moves a row restored a moment
  // earlier (deleting a return gave the shelf its unit back after the stock was reset).
  if (CMD === "restore") {
    for (let pass = 1; pass <= 3; pass++) {
      const s = await restore(before);
      if (!Object.keys(s).length) break;
      console.log(`revertido (pasada ${pass}):`, JSON.stringify(s));
    }
  }
  const left = diff(before, await capture());
  if (left.length) {
    console.log(`QUEDAN ${left.length} diferencias:`);
    for (const c of left.slice(0, 30)) {
      const cols = c.kind === "changed" ? Object.keys(c.row).filter((k) => k !== "updated_at" && JSON.stringify(c.row[k]) !== JSON.stringify(c.now[k])).map((k) => `${k}: ${JSON.stringify(c.row[k])} → ${JSON.stringify(c.now[k])}`).join(", ") : "";
      console.log(`  ${c.kind} ${c.t} ${c.row?.id ?? c.path ?? ""} ${cols}`);
    }
    process.exit(1);
  }
  console.log(`demo idéntica al snapshot «${NAME}»`);
}
