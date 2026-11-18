// Captures for the Reportes adjustments of 2026-11-17 (the two closes at the top of
// Facturación, «Por cobrar», «Ventas de contado», the blocks with their own titles, «Pedidos»,
// the «Descargar» options and the assistant's links), taken from the dev app through daemon.mjs
// with the demo account. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node reportes-ajustes-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// READ-ONLY: nothing is written. The «Descargar» menu is opened and closed; the day's sheet is
// opened and closed.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportScreen } from "./figma-export.mjs";

const WEB = (process.argv[2] ?? "phone") === "web";
const OUT = fileURLToPath(new URL("./raw/reportes-ajustes/", import.meta.url));
const FIGMA = fileURLToPath(new URL("./raw/figma/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 9000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.activeElement?.blur?.(); document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); 1");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  const f = await exportScreen(call, `ra-${name(n)}`, FIGMA);
  console.log(`  ✔ ${name(n)}  (${f.nodes} capas)`);
};
// The sticky header is ~112px collapsed on the phone and taller on the web.
const MARGEN = WEB ? 300 : 130;
// Measured, not assumed: the sticky header's bottom after the scroll, plus 12px.
const aSeccion = (id) =>
  ev(`(async()=>{const e=document.getElementById(${JSON.stringify(id)}); if(!e) throw new Error('NO ${id}');
    scrollTo(0, e.getBoundingClientRect().top + scrollY - ${MARGEN}); await new Promise(r=>setTimeout(r,500));
    const fijo=[...document.querySelectorAll('body *')].filter(x=>{const c=getComputedStyle(x);return (c.position==='sticky'||c.position==='fixed')&&x.getBoundingClientRect().top<=1&&x.getBoundingClientRect().height>60&&x.getBoundingClientRect().height<innerHeight/2&&x.getBoundingClientRect().width>200;});
    const tope=Math.max(0,...fijo.map(x=>x.getBoundingClientRect().bottom));
    scrollBy(0, e.getBoundingClientRect().top - tope - 12); await new Promise(r=>setTimeout(r,500)); return tope})()`);
const pointer = (expr, ms = 1200) =>
  ev(`(async()=>{const b=${expr}; if(!b) throw new Error('NOT FOUND'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,${ms})); return 1})()`);
const escape = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); new Promise(r=>setTimeout(r,800))");

const BASE = "http://localhost:3000";

await go(`${BASE}/reportes?tab=facturacion`, 12000);
await ev("scrollTo(0,0); new Promise(r=>setTimeout(r,400))");
await shot("facturacion-arriba");
await aSeccion("cierre-del-dia");
await shot("cierre-del-dia");
await ev(`(async()=>{const b=[...document.querySelectorAll('#cierre-del-dia button')].find(b=>/Ver todo/.test(b.textContent)); b.click(); await new Promise(r=>setTimeout(r,1500)); return 1})()`);
await shot("ventas-de-hoy");
await escape();
await aSeccion("cierre-del-mes");
await shot("cierre-del-mes");
await aSeccion("cartera");
await shot("por-cobrar-y-ventas");
await aSeccion("transacciones");
await shot("transacciones");
await aSeccion("abonos");
await shot("abonos-fiados-devoluciones");
await aSeccion("pedidos");
await shot("pedidos");
await ev("scrollTo(0,0); new Promise(r=>setTimeout(r,400))");
await pointer(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Descargar')`);
await shot("menu-descargar");
await escape();

// The old WhatsApp address of «Ver mi margen»: it has to land on the month close.
await go(`${BASE}/reportes?tab=inventario&seccion=margen`, 12000);
await shot("ver-mi-margen-llega");
