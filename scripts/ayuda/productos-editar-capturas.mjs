// Captures for the release document of three product changes of 2026-11-16 (the product page
// lists only the enabled currencies, the price step without the chain, and «Editar» on a
// cart line whose product was created in the sale), taken from the dev app through daemon.mjs
// with the demo account. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node productos-editar-capturas.mjs [phone|web]
//
// WRITES IN DEV, and undoes it in a `finally`: euros are enabled for a moment on one demo
// product (and removed), and a product created in the sale is deleted by its id after
// checking its name. No sale is finalised.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const MODE = process.argv[2] ?? "phone";
const WEB = MODE === "web";
const OUT = fileURLToPath(new URL("./raw/productos-editar/", import.meta.url));
const M = JSON.parse(readFileSync(new URL("./demo-manifest.json", import.meta.url), "utf8"));
const PRODUCT = "034777c7-e584-4410-b921-077426b22026"; // demo «Sal fina 1 kg», priced in dollars only
const TEST_NAME = "Phone";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("Dev only.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 6000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const wait = (ms) => ev(`new Promise(r=>setTimeout(r,${ms}))`);
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.activeElement?.blur?.(); document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); 1");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  console.log(`  ✔ ${name(n)}`);
};
const clickText = (t, ms = 2500) =>
  ev(`(async()=>{const e=[...document.querySelectorAll('button,a')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop(); if(!e) throw new Error('NOT FOUND ${t}'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
const set = (sel, value) =>
  ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); const p=HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
const top = (expr, margin = 16) =>
  ev(`(()=>{const e=${expr}; if(!e) return 0; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return 1})()`);

const BASE = "http://localhost:3000";
let creado = null;
try {
  // 1. Dollars only: one price row.
  await go(`${BASE}/productos/${PRODUCT}`);
  await top(`[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Venta al detal')`, 120);
  await shot("detalle-una-moneda");

  // 2. Euros enabled: both rows, and the price step with a typed euro.
  await admin.from("product_currencies").insert({ product_id: PRODUCT, tier: "retail", currency: "EUR" });
  await go(`${BASE}/productos/${PRODUCT}`);
  await top(`[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Venta al detal')`, 120);
  await shot("detalle-dos-monedas");
  await go(`${BASE}/productos/${PRODUCT}/editar`);
  await clickText("Continuar", 2000);
  // No chain since the owner's request of 2026-11-16: the euro is typed like the dollar, and the
  // margin follows the last price typed. Nothing is saved.
  await ev(`(async()=>{const el=document.getElementById('precio_retail_EUR'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'1,10'); el.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); return 1})()`);
  await top(`[...document.querySelectorAll('label')].find(s=>s.textContent.trim()==='Margen al detal')`, 120);
  await shot("precio-sin-cadena");
} finally {
  await admin.from("product_currencies").delete().eq("product_id", PRODUCT).eq("tier", "retail").eq("currency", "EUR");
}

try {
  // 3. A product created in the sale: «Editar» on its line, and the sheet it opens.
  await go(`${BASE}/ventas/nueva`);
  await clickText("Agregar producto", 1500);
  await set("#qp-nombre", TEST_NAME);
  await set("#qp-precio", "7,50");
  await ev(`(async()=>{const s=document.querySelector('[role=dialog] [role=switch]'); if(s&&s.getAttribute('aria-checked')==='true') s.click(); await new Promise(r=>setTimeout(r,300)); return 1})()`);
  await ev(`(async()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>/^Agregar/.test(b.textContent.trim())); b.click(); await new Promise(r=>setTimeout(r,6000)); return 1})()`);
  // ONLY ONE CREATED IN THE LAST FIVE MINUTES: a demo product with the same name must never be
  // the one deleted below (it happened once in this account, memory «borrar por id»).
  const desde = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await admin.from("products").select("id,name").eq("owner_id", M.ownerId).eq("name", TEST_NAME)
    .gte("created_at", desde).order("created_at", { ascending: false }).limit(1);
  creado = data?.[0]?.id ?? null;
  await ev(`(async()=>{const b=[...document.querySelectorAll('button,a')].find(b=>/Ver carrito/.test(b.textContent)&&b.getBoundingClientRect().height>0); b?.click(); await new Promise(r=>setTimeout(r,2000)); return 1})()`);
  await ev(`(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Agregar uno'); b?.click(); await new Promise(r=>setTimeout(r,800)); return 1})()`);
  await shot("carrito-editar");
  await clickText("Editar", 1800);
  await shot("hoja-editar-producto");
} finally {
  if (creado) {
    const { data: p } = await admin.from("products").select("name").eq("id", creado).single();
    const { count } = await admin.from("sale_lines").select("id", { count: "exact", head: true }).eq("product_id", creado);
    if (p?.name === TEST_NAME && !count) {
      await admin.from("product_currencies").delete().eq("product_id", creado);
      await admin.from("products").delete().eq("id", creado);
      console.log("  limpieza: producto de prueba borrado");
    } else console.log("  limpieza: NO se borró", p?.name, count);
  }
}
