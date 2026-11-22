// The five help pictures v0.11.0 changes, and only those, so the rest of each topic keeps the
// picture it had. Same service and demo account as temas/*.mjs; run with the daemon up:
//   MSYS_NO_PATHCONV=1 node v0110-ayuda-capturas.mjs
// WRITES NOTHING: step 1/3 is only looked at, and the order's draft is not touched.
//
//   atender-un-pedido/5, /6   step 1/3 now ends in two buttons (CT-181)
//   atender-un-pedido/14      «Agregar producto», the new step
//   ver-tus-reportes/6        the month's close without its own «Descargar»
//   compartir-el-link-del-cliente/3   the client's link with «Calculadora» (CT-180)
import { go, shot, js, sleep, waitFor, clearPopups } from "./lib.mjs";
import { M } from "./temas/_m.mjs";

// A slow connection (a VPN, on 2026-11-20) took these pages past the default 30 s.
const SLOW = 150000;
const ORDER = "3e2b135d-60d0-43d1-8ab0-345d53f6ff48";
let S = "atender-un-pedido";
await go(`/productos/ordenes/${ORDER}/registrar/confirmar?moneda=USD`, 6000);
await waitFor("document.body.innerText.includes('Agregar producto')", SLOW);
// No draft from an earlier run: the pictures show the order as the customer sent it.
await js(`Object.keys(sessionStorage).filter(k=>k.startsWith('sevenz:pedido-registro:${ORDER}')).forEach(k=>sessionStorage.removeItem(k)); 1`);
await go(`/productos/ordenes/${ORDER}/registrar/confirmar?moneda=USD`, 6000);
await waitFor("document.body.innerText.includes('Agregar producto')", SLOW); await sleep(2500);
await shot(S, 5, "Cambiar");
await shot(S, 6, "Confirmar y continuar", { crop: 0 });
await shot(S, 14, "Agregar producto", { crop: 0 });

S = "ver-tus-reportes";
const TITLE = (id) => `js:document.getElementById(${JSON.stringify(id)}).querySelector('p').parentElement`;
const place = async (target, top = 268) => {
  const expr = target.slice(3);
  for (let i = 0; i < 2; i++) {
    await js(`(()=>{const e=${expr}; scrollTo({top: e.getBoundingClientRect().top + scrollY - ${top}, behavior:'instant'}); return 1})()`);
    await sleep(500);
  }
};
await go(`/reportes`, 9000);
await waitFor("!!document.getElementById('cierre-del-mes')", SLOW);
await place(TITLE("cierre-del-mes"));
await shot(S, 6, TITLE("cierre-del-mes"), { crop: 0, pad: 6 });

S = "compartir-el-link-del-cliente";
await go(`/s/${M.shareToken}`, 6000);
await waitFor("document.body.innerText.includes('Calculadora')", SLOW);
await clearPopups(); await sleep(500);
await shot(S, 3, null, { crop: 0 });
console.log("listo");
