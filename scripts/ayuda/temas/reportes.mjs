import { go, shot, openMenu, escape, MENU, js, sleep } from "../lib.mjs";
import { H2, BLOCK, NAV } from "./_m.mjs";
const S = "ver-tus-reportes";
// A section of the Facturación tab, by the id its anchor uses (lib/reports/secciones.ts).
const SECTION = (id) => `js:document.getElementById(${JSON.stringify(id)})`;
// The title and subtitle that open a section's card.
const TITLE = (id) => `${SECTION(id)}.querySelector('p').parentElement`;
// Puts the target right under the sticky header (253px once it has collapsed) before the
// picture. Left to the capture service, a block taller than what is left of the screen was
// centred, and its top ended up behind the header. Twice: the header collapses on the first
// scroll and moves everything.
const place = async (target, top = 268) => {
  const expr = target.slice(3);
  for (let i = 0; i < 2; i++) {
    await js(`(()=>{const e=${expr}; scrollTo({top: e.getBoundingClientRect().top + scrollY - ${top}, behavior:'instant'}); return 1})()`);
    await sleep(500);
  }
};
await go(`/dashboard`, 4000);
await shot(S, 1, NAV("Reportes"));
await go(`/reportes`, 9000);
await shot(S, 2, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Facturación').parentElement");
await shot(S, 3, "js:[...document.querySelectorAll('button')].find(b=>/^del /.test(b.textContent.trim()))");
await shot(S, 4, BLOCK("Asistente", "útil"), { crop: 0, pad: 2 });
// v0.10.0: the day's and the month's close open Facturación, and the tab got its own blocks
// for «Ventas de contado», «Pedidos» and «Métodos de pago».
await place(TITLE("cierre-del-dia"));
await shot(S, 5, TITLE("cierre-del-dia"), { crop: 0, pad: 6 });
await place(TITLE("cierre-del-mes"));
await shot(S, 6, TITLE("cierre-del-mes"), { crop: 0, pad: 6 });
await place(SECTION("cartera"));
await shot(S, 7, SECTION("cartera"), { crop: 0, pad: 4 });
await place(SECTION("metodos-de-pago"), 260);
await shot(S, 8, SECTION("metodos-de-pago"), { crop: 0, pad: 2 });
await go(`/reportes?tab=inventario`, 9000);
await place(H2("Métricas del inventario"));
await shot(S, 9, H2("Métricas del inventario"), { crop: 0, pad: 6 });
await shot(S, 10, BLOCK("Avísame cuando queden"));
await go(`/reportes?tab=proveedores`, 9000);
await place(H2("Métricas de proveedores"));
await shot(S, 11, H2("Métricas de proveedores"), { crop: 0, pad: 6 });
await go(`/reportes`, 9000);
await openMenu("Descargar", { wait: 1500 });
await shot(S, 12, MENU, { blur: false });
await escape();
