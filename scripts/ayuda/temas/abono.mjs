// «Registrar un abono»: $20 from Julia Ramírez (demo business), entering from
// her page. With --finalizar it WRITES the payment in dev.
import { go, click, type, shot, openMenu, escape, MENU, js, sleep , waitFor } from "../lib.mjs";
import { readFileSync } from "node:fs";
const M = JSON.parse(readFileSync(new URL("../demo-manifest.json", import.meta.url), "utf8"));
const S = "registrar-un-abono";

await go(`/clients/${M.clientes.julia}`, 5000);
await shot(S, 1, "Agregar abono");
await click("Agregar abono", { wait: 5000 });
await type("js:document.querySelector('input[placeholder=\"00\"]')", "20", { wait: 1500 });
await shot(S, 2, "js:document.querySelector('input[placeholder=\"00\"]')", {});
await openMenu("Dólares");
await shot(S, 3, MENU, { blur: false });
await escape(); await sleep(600);
await shot(S, 4, "js:[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Así se reparte')).parentElement");
await click("Repartir manualmente", { wait: 2000 });
await shot(S, 5, "js:document.querySelector('[role=dialog]')", { crop: 0, pad: 0 });
await escape(); await sleep(800);
await shot(S, 6, "acepta recibir avisos");
await shot(S, 7, "Pagar y finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Pagar y finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  await js("window.scrollTo(0,0)");
  await shot(S, 8, "Compartir", { crop: 0 });
}
