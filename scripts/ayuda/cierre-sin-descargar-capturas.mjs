// Captures for the release document of v0.11.0's change to Reportes: the month-close card no
// longer carries its own «Descargar» (owner's request of 2026-11-19). Demo account in dev,
// through daemon.mjs. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node cierre-sin-descargar-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// READ-ONLY: nothing is written. The header's «Descargar» menu is opened and closed.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = (process.argv[2] ?? "phone") === "web";
const OUT = fileURLToPath(new URL("./raw/cierre-sin-descargar/", import.meta.url));
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
  console.log(`  ✔ ${name(n)}`);
};
const MARGEN = WEB ? 300 : 130;
// Same measured scroll as reportes-ajustes-capturas.mjs: the block lands 12px under the sticky header.
const aSeccion = (id) =>
  ev(`(async()=>{const e=document.getElementById(${JSON.stringify(id)}); if(!e) throw new Error('NO ${id}');
    scrollTo(0, e.getBoundingClientRect().top + scrollY - ${MARGEN}); await new Promise(r=>setTimeout(r,500));
    const fijo=[...document.querySelectorAll('body *')].filter(x=>{const c=getComputedStyle(x);const r=x.getBoundingClientRect();return (c.position==='sticky'||c.position==='fixed')&&r.top<=1&&r.height>60&&r.height<innerHeight/2});
    const tope=Math.max(0,...fijo.map(x=>x.getBoundingClientRect().bottom));
    scrollBy(0, e.getBoundingClientRect().top - tope - 12); await new Promise(r=>setTimeout(r,500)); return tope})()`);
const pointer = (expr, ms = 1200) =>
  ev(`(async()=>{const b=${expr}; if(!b) throw new Error('NOT FOUND'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,${ms})); return 1})()`);
const escape = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); new Promise(r=>setTimeout(r,800))");

await go("http://localhost:3000/reportes?tab=facturacion", 12000);
// On a slow connection the tab takes well past the 12 s above: poll for the card, up to 150 s.
for (let t = 0; t < 150000 && !(await ev("!!document.getElementById('cierre-del-mes')")); t += 1000) await new Promise((r) => setTimeout(r, 1000));
// What the picture has to prove, read off the page and not assumed.
const leido = await ev(`(()=>{const m=document.getElementById('cierre-del-mes'), d=document.getElementById('cierre-del-dia');
  const b=(e)=>[...e.querySelectorAll('button,a')].map(x=>x.textContent.trim()).filter(Boolean);
  return JSON.stringify({w: innerWidth, mes: m ? b(m) : 'NO', dia: d ? b(d) : 'NO'})})()`);
console.log("  botones:", leido);
if (/Descargar/.test(JSON.parse(leido).mes.join("|"))) throw new Error("la tarjeta del mes todavía lleva «Descargar»");
await aSeccion("cierre-del-mes");
await shot("1-cierre-del-mes");
await ev("scrollTo(0,0); new Promise(r=>setTimeout(r,400))");
await pointer(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Descargar')`);
console.log("  menú:", await ev(`JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map(x=>x.textContent.trim()))`));
await shot("2-menu-descargar");
await escape();
console.log("listo", WEB ? "web" : "teléfono");
