// «Registrar un abono»: $4 from Julia Ramírez (demo business), entering from her page. It needs
// her with TWO open fiados, so the split and «Repartir manualmente» show: run
// `venta.mjs --finalizar` first, which leaves her a second one. With --finalizar it WRITES the
// payment in dev. The amount was $20 until v0.10.0, more than she owed by then.
import { go, click, type, shot, openMenu, escape, MENU, js, sleep , waitFor } from "../lib.mjs";
import { readFileSync } from "node:fs";
const M = JSON.parse(readFileSync(new URL("../demo-manifest.json", import.meta.url), "utf8"));
const S = "registrar-un-abono";
// v0.10.0 (migration 214): «Método de pago». Found by its label: the field's id differs
// between the one-fiado screen and the split.
const METODO = "js:document.getElementById([...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Método de pago').htmlFor).parentElement";

await go(`/clients/${M.clientes.julia}`, 5000);
await shot(S, 1, "Agregar abono");
await click("Agregar abono", { wait: 5000 });
await type("js:document.querySelector('input[placeholder=\"00\"]')", "4", { wait: 1500 });
await shot(S, 2, "js:document.querySelector('input[placeholder=\"00\"]')", {});
await openMenu("Dólares");
await shot(S, 3, MENU, { blur: false });
await escape(); await sleep(600);
await shot(S, 4, "js:[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Así se reparte')).parentElement");
// The consent and the buttons are a bar stuck to the bottom: a field lying under it counts as
// "on screen", so the ring was drawn over the bar. Bring the field to the middle first.
await js(`(()=>{${METODO.slice(3)}.scrollIntoView({block:'center',behavior:'instant'}); return 1})()`);
await sleep(400);
await shot(S, 5, METODO, { pad: 6 });
await click("Repartir manualmente", { wait: 2000 });
await shot(S, 6, "js:document.querySelector('[role=dialog]')", { crop: 0, pad: 0 });
await escape(); await sleep(800);
await shot(S, 7, "acepta recibir avisos");
await shot(S, 8, "Pagar y finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Pagar y finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  // The bottom bar sits on top of «Compartir» at rest: bring the button to the middle.
  await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir')?.scrollIntoView({block:'center',behavior:'instant'})");
  await sleep(500);
  await shot(S, 9, "Compartir", { crop: 0 });
  // Printed for the clean-up: the payment is removed BY ID afterwards.
  console.log("url final:", await js("location.pathname + location.search"));
}
