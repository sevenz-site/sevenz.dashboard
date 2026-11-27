// «Registrar una venta o un fiado»: the sale wizard, end to end, as a fiado to
// Julia Ramírez (demo business). Finishing it WRITES a real sale in dev.
import { go, click, type, shot, sleep, DIALOG, js , waitFor } from "../lib.mjs";
const S = "registrar-un-fiado";

await go("/dashboard", 4000);
await shot(S, 1, "Registrar");
await click("Registrar", { wait: 1200 });
await shot(S, 2, "Fiado o venta", { scope: DIALOG });
await click("Fiado o venta", { wait: 6000 });
await shot(S, 3, "Ver Harina de maíz 1 kg", { pad: 4 });
await click("Ver Harina de maíz 1 kg", { wait: 1500 });
await shot(S, 4, "Agregar $", { scope: DIALOG });
await click("Agregar $", { scope: DIALOG, wait: 1200 });
await click("Ver Arroz blanco 1 kg", { wait: 1200 });
await click("Agregar $", { scope: DIALOG, wait: 1200 });
await js("window.scrollTo(0,0)");
await shot(S, 5, "Ver carrito");
await click("Ver carrito", { wait: 1500 });
await shot(S, 6, "Ir a pago", { crop: 0 });
await click("Ir a pago", { wait: 2500 });
await shot(S, 7, "Pagar");
await click("Pagar", { wait: 1800 });
await shot(S, 8, "De contado", { scope: DIALOG });
// v0.10.0 (migration 214): «Método de pago» under the amount, whenever something is paid now.
// Since v0.14.0 it opens empty on «Seleccionar opción» and is required; the fiado this script
// registers hands nothing over, so no method is asked for when it pays.
await shot(S, 9, "js:document.getElementById('pago-metodo-USD').parentElement", { scope: DIALOG, pad: 6 });
await click("Fiado o crédito", { scope: DIALOG, wait: 1200 });
await shot(S, 10, "Fiado o crédito", { scope: DIALOG });
await shot(S, 11, "js:document.querySelector('[role=dialog] input[placeholder=\"00\"]').closest('div.flex, div')", { scope: DIALOG });
await shot(S, 12, "7 días", { scope: DIALOG });
await js("[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop().scrollIntoView({block:'center'})");
await shot(S, 13, "js:[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop()");
await js("[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop().click()");
await sleep(1500);
await shot(S, 14, "Continuar", { crop: 0 });
await click("Continuar", { wait: 2000 });
await shot(S, 15, "Buscar cliente");
await type("Buscar cliente", "Julia", { wait: 1500 });
await shot(S, 16, "Julia Ramírez", { blur: false });
await click("Julia Ramírez", { wait: 1500 });
await shot(S, 17, "acepta recibir avisos");
await shot(S, 18, "Finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  // The bottom bar is back on the success screens (2026-10-24) and, at rest, sits on top of
  // «Compartir»: the ring landed on the bar. Bring the button to the middle first.
  await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir')?.scrollIntoView({block:'center',behavior:'instant'})");
  await sleep(500);
  await shot(S, 19, "Compartir", { crop: 0 });
  // Printed for the clean-up: the sale is removed BY ID afterwards.
  console.log("url final:", await js("location.pathname + location.search"));
}
