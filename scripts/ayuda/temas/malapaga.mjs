// Opens the dialog and fills it, but does NOT confirm: the demo business keeps
// its one existing mala paga, which is what step 4 photographs.
import { go, click, type, shot, escape, sleep, DIALOG } from "../lib.mjs";
import { M } from "./_m.mjs";
const S = "marcar-una-mala-paga";
const TA = "js:document.querySelector('[role=dialog] textarea')";
await go(`/clients/${M.clientes.pedro}`, 5000);
await shot(S, 1, "Marcar como mala paga");
await click("Marcar como mala paga", { wait: 1500 });
await type(TA, "Lleva tres meses sin abonar y no contesta.");
await shot(S, 2, TA, { blur: false });
await shot(S, 3, "Marcar como mala paga", { scope: DIALOG });
await escape(); await sleep(800);
await go(`/malas-pagas`, 5000);
await shot(S, 4, null, { crop: 0 });
// Alexis Montilla is the demo's standing mala paga: the way back.
await go(`/clients/${M.clientes.alexis}`, 5000);
await shot(S, 5, "Desmarcar como mala paga");
await click("Desmarcar como mala paga", { wait: 1500 });
await shot(S, 6, "Desmarcar", { scope: DIALOG });
await escape(); await sleep(500);
