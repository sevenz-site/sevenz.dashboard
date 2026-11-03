import { go, shot, openMenu, escape, MENU } from "../lib.mjs";
import { H2, BLOCK, NAV } from "./_m.mjs";
const S = "ver-tus-reportes";
await go(`/dashboard`, 4000);
await shot(S, 1, NAV("Reportes"));
await go(`/reportes`, 8000);
await shot(S, 2, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Facturación').parentElement");
await shot(S, 3, "js:[...document.querySelectorAll('button')].find(b=>/^del /.test(b.textContent.trim()))");
await shot(S, 4, BLOCK("Asistente", "útil"), { crop: 0, pad: 2 });
// (no step 5: the Cartera card is described in the text, not pictured)
await go(`/reportes?tab=inventario`, 8000);
await shot(S, 6, BLOCK("Productos disponibles", "Referencias agotadas"), { pad: 2 });
await shot(S, 7, BLOCK("Avísame cuando queden"));
await go(`/reportes?tab=proveedores`, 8000);
await shot(S, 8, H2("Métricas de proveedores"), { crop: 0, pad: 2 });
await go(`/reportes`, 8000);
await openMenu("Descargar", { wait: 1500 });
await shot(S, 9, MENU, { blur: false });
await escape();
