// Captures for the release document of «Agregar producto» on step 1/3 of registering a
// catalogue order (CT-181, owner's request of 2026-11-19). Taken from the dev app through
// daemon.mjs with the demo account («Mini abasto El Chino»), on the demo order of Karina
// Medina. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node agregar-al-pedido-capturas.mjs [phone|web]
// `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// WRITES NOTHING TO THE DATABASE. Everything here lives in the order's browser draft
// (`sessionStorage`), which is cleared at the start and at the end; no sale is registered,
// so the demo order stays usable.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = process.argv[2] === "web";
const OUT = fileURLToPath(new URL("./raw/agregar-al-pedido/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const BASE = "http://localhost:3000";
const PEDIDO = "3e2b135d-60d0-43d1-8ab0-345d53f6ff48";
const CONFIRMAR = `/productos/ordenes/${PEDIDO}/registrar/confirmar?moneda=USD`;
const go = (url, wait = 7000) => call({ op: "go", url: BASE + url, wait });
const ev = (expr) => call({ op: "eval", expr });
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.querySelectorAll('nextjs-portal,[data-sonner-toaster]').forEach(e=>e.remove()); document.activeElement?.blur?.(); new Promise(r=>setTimeout(r,500))");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  console.log(`  ✔ ${name(n)}`);
};
const clearDraft = () =>
  ev(`Object.keys(sessionStorage).filter(k=>k.startsWith('sevenz:pedido-registro:${PEDIDO}')).forEach(k=>sessionStorage.removeItem(k)); 'ok'`);
const click = (expr, ms = 1500) =>
  ev(`(()=>{const e=${expr}; if(!e) throw new Error('NOT FOUND: ' + ${JSON.stringify(expr)}); e.click(); return new Promise(r=>setTimeout(r,${ms}))})()`);
const button = (t) =>
  `[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;
const dialog = "[...document.querySelectorAll('[role=dialog]')].pop()";
const card = (producto) => `document.querySelector('button[aria-label=${JSON.stringify(`Ver ${producto}`)}]')`;
const agregarEnHoja = `[...${dialog}.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Agregar $'))`;
const scrollTop = () => ev("scrollTo(0,0); new Promise(r=>setTimeout(r,500))");
const scrollBottom = () => ev("scrollTo(0, document.body.scrollHeight); new Promise(r=>setTimeout(r,600))");

// 0. The order as the customer sent it: no draft left from a previous run.
await go(CONFIRMAR);
await clearDraft();
await go(CONFIRMAR);

// 1. Step 1/3 with «Agregar producto» under «Confirmar y continuar».
await scrollTop();
await shot("1-paso-con-agregar");

// 2. The sheet «Agregar al pedido».
await click(button("Agregar producto"), 3500);
await shot("2-hoja-agregar");

// 3. The product sheet: the currency is the order's, with no choice.
await click(card("Azúcar 1 kg"), 2000);
await shot("3-hoja-producto");

// 4. Added: at the end of the list, without «Cantidad del pedido».
await click(agregarEnHoja, 2500);
await scrollBottom();
await shot("4-producto-agregado");
await scrollTop();
await shot("4b-total-sube");

// 5. A product the order already has: it adds to its card.
await click(button("Agregar producto"), 3500);
await click(card("Harina de maíz 1 kg"), 2000);
await click(agregarEnHoja, 2500);
await scrollTop();
await shot("5-ya-estaba");

// 6. Step 2/3 charges what the screen showed.
await go(`/productos/ordenes/${PEDIDO}/registrar/pago?moneda=USD`, 9000);
await scrollTop();
await shot("6-pago");

// Leave the demo order as it was.
await clearDraft();
console.log("listo", WEB ? "web" : "teléfono");
