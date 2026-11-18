// Captures and editable Figma layers for the change of 2026-11-18 (owner's request): the
// address box under the address in Mi negocio, the «Personalizar catálogo» card, and the
// «Dirección» block gone from Personalizar catálogo. Taken from the dev app through daemon.mjs
// with the demo account («Mini abasto El Chino»). Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node negocio-catalogo-capturas.mjs [phone|web]
// `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// WRITES NOTHING. The form is edited only on screen and left through «Salir sin guardar».
// The dirty states go last: a dirty Mi negocio holds a «leave without saving» prompt that
// would hang the next navigation.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportScreen } from "./figma-export.mjs";

const WEB = process.argv[2] === "web";
const OUT = fileURLToPath(new URL("./raw/negocio-catalogo/", import.meta.url));
const FIGMA = fileURLToPath(new URL("./raw/figma/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const BASE = "http://localhost:3000";
const go = (url, wait = 6000) => call({ op: "go", url: BASE + url, wait });
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); document.activeElement?.blur?.(); new Promise(r=>setTimeout(r,400))");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  const f = await exportScreen(call, `nc-${name(n)}`, FIGMA);
  console.log(`  ✔ ${name(n)}  (${f.nodes} capas)`);
};
// Puts the element `margin` px under the top of the screen.
const top = (expr, margin) =>
  ev(`(()=>{const e=${expr}; if(!e) throw new Error('NOT FOUND'); scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return new Promise(r=>setTimeout(r,500))})()`);
const RIF = "document.querySelector('label[for=tax_id]')";
const ADDRESS = "document.querySelector('#address')";
const BOX = "[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Mostrar mi dirección en el catálogo'))";
const setAddress = (v) =>
  ev(`(()=>{const i=${ADDRESS}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return new Promise(r=>setTimeout(r,500))})()`);
const click = (expr, ms = 1500) => ev(`(()=>{const e=${expr}; if(!e) throw new Error('NOT FOUND'); e.click(); return new Promise(r=>setTimeout(r,${ms}))})()`);
const button = (t) => `[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;
const margin = WEB ? 120 : 90;

// 1. Mi negocio as the demo has it: RIF above the address, the box, the card.
await go("/profile", 7000);
await top(RIF, margin);
await shot("1-mi-negocio");

// 2. No address: the box goes off. 3. Address written and the box ticked.
await setAddress("");
await top(RIF, margin);
await shot("2-sin-direccion");
await setAddress("Av. Principal, Caracas");
await click(`${BOX}.querySelector('button')`, 600);
await top(RIF, margin);
await shot("3-casilla-marcada");

// 4. «Personalizar» with those changes unsaved: the usual prompt.
await click(button("Personalizar"), 1500);
await shot("4-aviso-sin-guardar");

// 5. Leave without saving: Personalizar catálogo, entered from Mi negocio.
await click(button("Salir sin guardar"), 6000);
await ev("scrollTo(0,0); new Promise(r=>setTimeout(r,500))");
await shot("5-personalizar-desde-negocio");

// 6. The end of that screen: logo and the buttons, no «Dirección» block before them.
await top("document.querySelector('label[for=catalog-welcome]')", margin);
await shot("6-personalizar-final");
console.log("listo", WEB ? "web" : "teléfono");
