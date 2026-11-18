// Captures for the «Método de pago» release document and its Figma frames (owner's request of
// 2026-11-17), taken from the dev app through daemon.mjs with the demo account. Run with the
// daemon up:
//   MSYS_NO_PATHCONV=1 node metodo-pago-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// WRITES IN DEV, on the phone run only: one cash sale of «Aceite vegetal 1 L» paid by Zelle, so
// its return dialog can be opened (and left unregistered). Its id is kept in
// raw/metodo-pago/sale.txt for the web run. The abono screens are filled and never submitted;
// their session drafts are cleared at the end so the next real abono does not open on them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { exportScreen } from "./figma-export.mjs";

const MODE = process.argv[2] ?? "phone";
const WEB = MODE === "web";
const OUT = fileURLToPath(new URL("./raw/metodo-pago/", import.meta.url));
const FIGMA = fileURLToPath(new URL("./raw/figma/", import.meta.url));
mkdirSync(OUT, { recursive: true });

// Demo data in dev (the «Mini abasto El Chino» business).
const NELSON = "1387ff13-75a2-43b8-976e-80a07505c5e5"; // owes dollars, several fiados
const NELSON_ABONO = "22dc0d03-2b22-487f-8cdf-62abcf0ed02e"; // Bs. 10.000 by Pago móvil
const RAFAEL_EUR_FIADO = "e411bcb6-c876-460b-96c0-beeb57924a32";
const RETURN_BINANCE = "742e1f0a-8137-42f8-9377-cb2eba2a45c9"; // refunded by Binance / USDT

// The client's share token is read from dev when the script runs, never written here: this
// repo is public, and a token opens that client's balance to whoever has it.
const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("Dev only.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: link } = await admin.from("share_links").select("token").eq("client_id", NELSON).maybeSingle();
if (!link) throw new Error("Nelson has no share link in dev: create one from his page («Compartir saldo»).");
const NELSON_TOKEN = link.token;

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 6000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n, figma = true) => {
  await ev("document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); 1");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  if (figma) {
    const f = await exportScreen(call, `mp-${name(n)}`, FIGMA);
    console.log(`  ✔ ${name(n)}  (${f.nodes} capas)`);
  } else console.log(`  ✔ ${name(n)}`);
};
const blur = () => ev("document.activeElement?.blur?.(); new Promise(r=>setTimeout(r,400))");
const clickBtn = (t, ms = 2500, exact = true) =>
  ev(`(async()=>{const e=[...document.querySelectorAll('button,a,[role=menuitem],[role=option]')].filter(b=>{const s=(b.getAttribute('aria-label')||b.textContent).trim(); return (${exact} ? s===${JSON.stringify(t)} : s.startsWith(${JSON.stringify(t)})) && b.getBoundingClientRect().height>0}).pop(); if(!e) throw new Error('NOT FOUND ${t}'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
// Radix opens Select and DropdownMenu on pointerdown, not click.
const pointer = (expr, ms = 1200) =>
  ev(`(async()=>{const b=${expr}; if(!b) throw new Error('NOT FOUND'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,${ms})); return 1})()`);
const pickOption = (t, ms = 900) =>
  ev(`(async()=>{const o=[...document.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio]')].find(o=>o.textContent.trim()===${JSON.stringify(t)}); if(!o) throw new Error('NO OPTION ${t}'); o.click(); await new Promise(r=>setTimeout(r,${ms})); return 1})()`);
const type = (sel, value) =>
  ev(`(async()=>{const el=document.querySelector(${JSON.stringify(sel)}); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,700)); return el.value})()`);
const top = (expr, margin = 16) =>
  ev(`(()=>{const e=${expr}; if(!e) return 0; const sc=e.closest('[role=dialog] *')&&e.closest('[role=dialog]'); if(sc){e.scrollIntoView({block:'center'}); return 2} scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return 1})()`);
const label = (t) => `[...document.querySelectorAll('label,h2,h3,dt,p,span')].find(s=>s.textContent.trim()===${JSON.stringify(t)})`;
const escape = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); new Promise(r=>setTimeout(r,800))");

const BASE = "http://localhost:3000";
const SALE_FILE = `${OUT}sale.txt`;

try {
  // 1. A cash sale: «Registrar pago» with the field, the list open, then paid by Zelle.
  await go(`${BASE}/ventas/nueva`);
  await ev("(async()=>{document.querySelector('input[placeholder=\"Buscar producto\"]')?.focus(); await new Promise(r=>setTimeout(r,1500)); return 1})()");
  await clickBtn("Ver Aceite vegetal 1 L", 2000);
  await clickBtn("Agregar", 1500, false);
  await clickBtn("Ver carrito", 2000, false);
  await clickBtn("Ir a pago", 2500, false);
  await clickBtn("Pagar", 2500);
  await top(label("Método de pago"), 0);
  await blur();
  await shot("venta-metodo-bolivares");
  // The book's own currency: «Efectivo».
  await pointer(`[...document.querySelectorAll('[role=dialog] button')].find(c=>c.textContent.trim()==='Bolívares')`);
  await pickOption("Dólares");
  await blur();
  await top(label("Método de pago"), 0);
  await shot("venta-metodo-dolares");
  await pointer(`document.getElementById('pago-metodo-USD')`);
  await shot("venta-lista-metodos");
  await pickOption("Zelle");
  if (!WEB) {
    await clickBtn("Pagar", 2000);
    await clickBtn("Continuar", 2500);
    await clickBtn("Finalizar sin cliente", 9000);
    const path = await ev("location.pathname");
    const id = /\/ventas\/([0-9a-f-]{36})/.exec(path)?.[1];
    if (!id) throw new Error(`sale not created: ${path}`);
    writeFileSync(SALE_FILE, id);
    console.log(`  venta creada en dev: ${id}`);
  } else await escape();

  const SALE = readFileSync(SALE_FILE, "utf8").trim();

  // 2. The owner's detail of that sale: «Método de pago: Zelle».
  await go(`${BASE}/transacciones/venta/${SALE}/usd`);
  await shot("ficha-venta-contado");

  // 3. Its return: «¿Cómo le devolviste el dinero?» opens on the sale's method. Not registered.
  await pointer(`document.querySelector('button[aria-label="Más opciones de Aceite vegetal 1 L"]')`);
  await clickBtn("Registrar devolución", 2000);
  await shot("devolucion-pregunta");
  await escape();

  // 4. The detail of a return refunded by Binance / USDT.
  await go(`${BASE}/transacciones/${RETURN_BINANCE}`);
  await top(label("¿Qué se hizo con el dinero?"), 80);
  await shot("ficha-devolucion");

  // 5. The split abono typed in bolívares: «Pago móvil». Not submitted.
  await go(`${BASE}/abonos/nuevo?cliente=${NELSON}&desde=cliente`);
  await pointer(`[...document.querySelectorAll('main button')].find(c=>c.textContent.trim()==='Dólares')`);
  await pickOption("Bolívares");
  await type("#monto", "10.000");
  await blur();
  await shot("abono-reparto");

  // 6. The abono to one fiado, in euros: «Efectivo». Not submitted.
  await go(`${BASE}/abonos/nuevo/${RAFAEL_EUR_FIADO}/monto?desde=detalle`);
  await type("#monto", "5");
  await blur();
  await shot("abono-dirigido");

  // 7. An abono's detail, owner and client.
  await go(`${BASE}/transacciones/${NELSON_ABONO}`);
  await top(label("Método de pago"), WEB ? 300 : 360);
  await shot("ficha-abono-dueno");
  await go(`${BASE}/s/${NELSON_TOKEN}/t/${NELSON_ABONO}`);
  await top(label("Método de pago"), WEB ? 300 : 360);
  await shot("ficha-abono-cliente");

  // 8. Reportes › Facturación › «Métodos de pago».
  await go(`${BASE}/reportes`, 9000);
  await top(`document.getElementById('metodos-de-pago')`, WEB ? 120 : 280);
  await shot("reportes-metodos-de-pago");
} finally {
  await ev(`(()=>{Object.keys(sessionStorage).filter(k=>k.startsWith('sevenz:reparto:')||k.startsWith('sevenz:flujo:')).forEach(k=>sessionStorage.removeItem(k)); return 1})()`).catch(() => {});
  if (!existsSync(SALE_FILE)) console.log("  (sin venta creada)");
}
