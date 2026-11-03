// Moves Carmen Linares (demo, no debt) to the bin and RESTORES her: leaves
// the demo business as it found it.
import { go, click, shot, openMenu, pick, js, sleep, DIALOG, waitFor } from "../lib.mjs";
import { M } from "./_m.mjs";
const S = "la-papelera";
await go(`/clients/${M.clientes.carmen}`, 5000);
await openMenu("Más opciones");
await shot(S, 1, "Mover a papelera", { blur: false });
await pick("Mover a papelera", { wait: 1500 });
await shot(S, 2, "Mover a papelera", { scope: DIALOG });
await click("Mover a papelera", { scope: DIALOG, wait: 1000 });
await waitFor("!location.pathname.startsWith('/clients/')").catch(() => {});
await sleep(3000);
await go(`/papelera`, 5000);
await shot(S, 3, "Restaurar");
await shot(S, 4, "Ocultar definitivamente");
await click("Restaurar", { wait: 2500 });
const dlg = await js("[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(d=>d.innerText).join('|')");
if (dlg) { console.log("confirmación:", dlg); await click("Restaurar", { scope: DIALOG, wait: 2500 }); }
await sleep(2000);
console.log(await js("document.body.innerText.slice(0,300)"));
