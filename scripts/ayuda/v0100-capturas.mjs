// Captures for the second half of v0.10.0 (owner's requests of 2026-11-17): bolivars with four
// decimals, «Deuda antigua» with its bolivar line and its swapped buttons, «Otros productos»
// aligned left on the order receipt, and «Consejos de Sevenz» with its unsubscribe page. For the
// release document and its Figma frames, from the dev app through daemon.mjs with the demo
// account. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node v0100-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// WRITES IN DEV, and undoes it:
//   - one catalogue order «QA Captura Recibo», deleted by id at the end;
//   - the demo owner's «Consejos de Sevenz» switched off by the unsubscribe page, switched back on
//     at the end.
// The new-client form is filled and never submitted.
import { mkdirSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { exportScreen } from "./figma-export.mjs";

const MODE = process.argv[2] ?? "phone";
const WEB = MODE === "web";
const OUT = fileURLToPath(new URL("./raw/v0100/", import.meta.url));
const FIGMA = fileURLToPath(new URL("./raw/figma/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("Dev only.");
if (!env.UNSUBSCRIBE_SECRET) throw new Error("UNSUBSCRIBE_SECRET is missing from .env.local.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The demo owner, and the two tokens this needs, read from dev when the script runs and never
// written here: this repo is public.
const { data: owner } = await admin.from("owners").select("id").eq("business_name", "Mini abasto El Chino").single();
const { data: catalogo } = await admin.from("catalog_share_links").select("token").eq("owner_id", owner.id).limit(1).single();
const UNSUB = `${owner.id}.${createHmac("sha256", env.UNSUBSCRIBE_SECRET).update(`product-tips:${owner.id}`).digest("base64url")}`;

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 6000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); 1");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  const f = await exportScreen(call, `v10-${name(n)}`, FIGMA);
  console.log(`  ✔ ${name(n)}  (${f.nodes} capas)`);
};
const blur = () => ev("document.activeElement?.blur?.(); new Promise(r=>setTimeout(r,400))");
const clickBtn = (t, ms = 2500, exact = true) =>
  ev(`(async()=>{const e=[...document.querySelectorAll('button,a,[role=menuitem],[role=option]')].filter(b=>{const s=(b.getAttribute('aria-label')||b.textContent).trim(); return (${exact} ? s===${JSON.stringify(t)} : s.startsWith(${JSON.stringify(t)})) && b.getBoundingClientRect().height>0}).pop(); if(!e) throw new Error('NOT FOUND ${t}'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
const clickContaining = (t, ms = 2500) =>
  ev(`(async()=>{const e=[...document.querySelectorAll('button,a')].find(b=>b.textContent.includes(${JSON.stringify(t)}) && b.getBoundingClientRect().height>0); if(!e) throw new Error('NOT FOUND ${t}'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
// Sets a React-controlled input the way typing does.
const type = (sel, value) =>
  ev(`(async()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) throw new Error('NO INPUT ${sel}'); el.focus(); await new Promise(r=>setTimeout(r,300)); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,700)); return el.value})()`);
const top = (expr, margin = 16) =>
  ev(`(()=>{const e=${expr}; if(!e) return 0; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return 1})()`);
const textEl = (t) => `[...document.querySelectorAll('h1,h2,h3,p,span,label,button')].find(s=>s.textContent.trim()===${JSON.stringify(t)})`;

const BASE = "http://localhost:3000";

try {
  // 1. The calculator on Inicio, with bolivars typed: four decimals in the field, the rate and the
  //    equivalent.
  await go(`${BASE}/dashboard`, 8000);
  await clickContaining("Calcular", 2500);
  await type("#calc-get", "12345678");
  await blur();
  await top(`document.querySelector('#calc-put')`, WEB ? 200 : 140);
  await shot("calculadora");

  // 2. «Información de deuda»: the bolivar line under «Deuda antigua», and the two buttons in their
  //    new order. Filled, never submitted.
  await go(`${BASE}/clients/nuevo`);
  await type('input[placeholder="Escribe nombres y apellidos"]', "Rosa Mendoza");
  await type("#document_id, input[name=document_id]", "18456732");
  await clickBtn("Continuar", 2500);
  await type('input[placeholder="00"]', "45");
  await blur();
  await shot("deuda-antigua");

  // 3. The client's catalogue: a product's price in bolivars, four decimals.
  const { data: aceite } = await admin.from("products").select("id").eq("owner_id", owner.id).eq("name", "Aceite vegetal 1 L").single();
  await go(`${BASE}/c/${catalogo.token}/${aceite.id}`, 7000);
  await shot("producto-cliente");

  // 4. The order receipt: «Otros productos» aligned with the rest. Writes one order, deleted below.
  await clickBtn("Agregar", 1500, false);
  await clickBtn("Ver carrito", 2500, false);
  await clickBtn("Completar orden", 1500);
  await type('input[placeholder="Escribe nombre y apellido"]', "QA Captura Recibo");
  await ev(`(async()=>{const set=(el,v)=>{el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}))}; const doc=[...document.querySelectorAll('input')].find(i=>(i.getAttribute('aria-label')||'')==='Documento'||(i.labels?.[0]?.textContent.trim()==='Documento')); if(doc&&!doc.value) set(doc,'18456733'); const tel=document.querySelector('input[type=tel]'); set(tel,'4145550188'); await new Promise(r=>setTimeout(r,600)); return 1})()`);
  await ev("window.open = () => null; 1");
  await clickBtn("Enviar pedido", 7000);
  await top(textEl("Otros productos"), WEB ? 160 : 120);
  await shot("recibo-otros-productos");

  // 5. Mi negocio › Notificaciones, open: «Consejos de Sevenz» under «Avisos por WhatsApp».
  await go(`${BASE}/profile`, 7000);
  await clickContaining("Avisos por WhatsApp", 1500);
  await top(textEl("Notificaciones"), WEB ? 120 : 80);
  await shot("consejos-sevenz");

  // 6. The unsubscribe page: the question, the done state, and an invalid link.
  await go(`${BASE}/consejos/baja/${encodeURIComponent(UNSUB)}`);
  await shot("baja-pregunta");
  await clickBtn("Dejar de recibir consejos", 3500);
  await shot("baja-listo");
  await go(`${BASE}/consejos/baja/enlace-no-valido`);
  await shot("baja-no-valido");
} finally {
  // Undo what the captures wrote.
  await admin.from("owners").update({ product_tips_opt_out_at: null }).eq("id", owner.id);
  const { data: orders } = await admin.from("catalog_orders").select("id").eq("owner_id", owner.id).eq("customer_name", "QA Captura Recibo");
  for (const o of orders ?? []) {
    await admin.from("catalog_order_items").delete().eq("order_id", o.id);
    await admin.from("catalog_orders").delete().eq("id", o.id);
  }
  console.log(`  limpieza: consejos encendidos otra vez, ${orders?.length ?? 0} pedido(s) de captura borrado(s)`);
}
