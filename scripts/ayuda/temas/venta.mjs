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
await click("Fiado o crédito", { scope: DIALOG, wait: 1200 });
await shot(S, 9, "Fiado o crédito", { scope: DIALOG });
await shot(S, 10, "js:document.querySelector('[role=dialog] input[placeholder=\"00\"]').closest('div.flex, div')", { scope: DIALOG });
await shot(S, 11, "7 días", { scope: DIALOG });
await js("[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop().scrollIntoView({block:'center'})");
await shot(S, 12, "js:[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop()");
await js("[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Pagar').pop().click()");
await sleep(1500);
await shot(S, 13, "Continuar", { crop: 0 });
await click("Continuar", { wait: 2000 });
await shot(S, 14, "Buscar cliente");
await type("Buscar cliente", "Julia", { wait: 1500 });
await shot(S, 15, "Julia Ramírez", { blur: false });
await click("Julia Ramírez", { wait: 1500 });
await shot(S, 16, "acepta recibir avisos");
await shot(S, 17, "Finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  await shot(S, 18, "Compartir", { crop: 0 });
}
