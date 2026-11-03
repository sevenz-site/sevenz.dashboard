// Only the entry: the rest of the flow needs real photos and the AI read.
import { go, shot } from "../lib.mjs";
const S = "importar-tu-libreta";
await go(`/dashboard`, 4000);
await shot(S, 1, "Subir libreta");
await go(`/import`, 5000);
await shot(S, 2, "js:[...document.querySelectorAll('*')].filter(e=>e.textContent.trim().startsWith('Toca para elegir fotos')).pop().closest('label,button,div')", { crop: 0 });
