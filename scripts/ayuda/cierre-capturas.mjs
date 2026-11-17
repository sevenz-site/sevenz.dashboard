// Captures for the release document of the «Cierre de …» card in Reportes › Inventario (v0.9.0),
// taken from the dev app through daemon.mjs. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node cierre-capturas.mjs [phone|web]
//
// Three cases, one picture each:
//   1. a month with no sales        -> a throw-away business, before any sale
//   2. a complete close with profit -> the same business, with last month's sales and their cost
//   3. under 80 % of lines costed   -> the demo business as it is
//
// WRITES IN DEV, and undoes it in a `finally`: the throw-away business is deleted with its
// sales (cascade). The demo business is only read. The daemon is left signed in as the demo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const WEB = (process.argv[2] ?? "phone") === "web";
const OUT = fileURLToPath(new URL("./raw/cierre-del-mes/", import.meta.url));
const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("Dev only.");
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const BASE = "http://localhost:3000";
const shot = async (n) => {
  await call({ op: "go", url: `${BASE}/reportes?tab=inventario&seccion=margen`, wait: 9000 });
  await ev("document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); 1");
  const ok = await ev(`(()=>{const e=[...document.querySelectorAll('h2')].find(s=>s.textContent.trim()==='Margen por producto'); if(!e) return location.pathname; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${WEB ? 300 : 260}); return 'ok'})()`);
  if (ok !== "ok") throw new Error(`no llegó a Reportes: ${ok}`);
  await ev("new Promise(r=>setTimeout(r,600))");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  console.log(`  ✔ ${name(n)}`);
};

const tag = Math.random().toString(36).slice(2, 8);
const email = `zz-cierre-doc-${tag}@example.com`;
let owner = null;
try {
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { business_name: "Bodega La Esquina", first_name: "Rosa", last_name: "Demo", country: "VE", whatsapp: "584145550199" },
  });
  if (eU) throw new Error(`createUser: ${eU.message}`);
  owner = u.user.id;
  await admin.from("owners").update({ country: "VE" }).eq("id", owner);
  const { data: c, error: eC } = await admin.from("clients").insert({ owner_id: owner, name: "Cliente de ejemplo" }).select("id").single();
  if (eC) throw new Error(`clients: ${eC.message}`);
  // ONE PRODUCT, or the whole Inventario tab is its empty state («sin productos») and the
  // card is never drawn.
  const { error: eP } = await admin.from("products").insert({ owner_id: owner, name: "Harina 1 kg", price_retail: 2, base_currency: "USD", base_currency_retail: "USD", stock_opening: 30 });
  if (eP) throw new Error(`products: ${eP.message}`);

  await call({ op: "login-as", email });
  await shot("sin-ventas");

  // The first instant of last month in Caracas (UTC-4, no daylight saving): what
  // `ultimoMesCerrado` gives the page for a Venezuelan business.
  const hoy = new Date(Date.now() - 4 * 3600_000);
  const desde = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1, 4);
  const dia = (n) => new Date(desde + n * 86400000).toISOString();
  const venta = async (createdAt, lineas) => {
    const { data: s, error } = await admin.from("sales").insert({ owner_id: owner, client_id: c.id, created_at: createdAt }).select("id").single();
    if (error) throw new Error(`sales: ${error.message}`);
    for (const [nombre, q, p, cur, cost] of lineas) {
      const { error: e } = await admin.from("sale_lines").insert({ sale_id: s.id, name: nombre, quantity: q, unit_price: p, currency: cur, unit_cost: cost });
      if (e) throw new Error(`sale_lines: ${e.message}`);
    }
  };
  // Every line with its frozen cost: 100 % covered, so the profit is complete.
  await venta(dia(2), [["Harina 1 kg", 20, 2, "USD", 1.4], ["Arroz 1 kg", 10, 1.8, "USD", 1.2]]);
  await venta(dia(9), [["Aceite 1 L", 6, 4.5, "USD", 3.2]]);
  await venta(dia(15), [["Café 250 g", 8, 3, "EUR", 2.1]]);
  await venta(dia(21), [["Queso 1 kg", 4, 7.5, "USD", 5.5], ["Azúcar 1 kg", 12, 1.5, "EUR", 1]]);
  await shot("completo");
} finally {
  // Back to the demo business first, so the daemon never stays signed in as a deleted account.
  await call({ op: "login-as", email: JSON.parse(readFileSync(new URL("./demo-manifest.json", import.meta.url), "utf8")).email }).catch((e) => console.log("  relogin:", e.message));
  if (owner) {
    const { error } = await admin.auth.admin.deleteUser(owner);
    console.log(error ? `  limpieza: NO se borró ${email}: ${error.message}` : "  limpieza: negocio de prueba borrado");
  }
}

await shot("incompleto");
