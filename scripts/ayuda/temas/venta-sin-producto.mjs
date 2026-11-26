// «Vender sin elegir producto» (v0.13.0, CT-183: «Omitir»). Demo business. READ ONLY: it stops
// on the Pago step, before anything is saved. The steps before «Omitir» reuse the pictures of
// «Registrar una venta o un fiado» (1 and 2), which show the same two taps.
import { go, click, type, shot, js, sleep, waitFor } from "../lib.mjs";

const S = "vender-sin-producto";
await go("/ventas/nueva", 6000);
await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Omitir')");
await shot(S, 1, "Omitir", { pad: 6 });
await click("Omitir", { wait: 1500 });
await waitFor("!!document.querySelector('#venta-monto-USD')");
await sleep(800);
await type("js:document.querySelector('#venta-monto-USD')", "5", { wait: 1200 });
await shot(S, 2, "js:document.querySelector('#venta-monto-USD')", { pad: 6 });
await shot(S, 3, "Agregar monto en Euro", { pad: 6 });
await type("js:document.querySelector('#venta-descripcion')", "Recarga de teléfono", { wait: 800 });
await shot(S, 4, "js:document.querySelector('#venta-descripcion')", { pad: 6 });
await click("Continuar", { wait: 2500 });
await waitFor("document.body.innerText.includes('Pago')&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Pagar')");
await sleep(1200);
await shot(S, 5, "js:[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pagar')", { pad: 6 });
