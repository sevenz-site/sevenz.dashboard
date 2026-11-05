// «Crear un producto»: Queso blanco 1 kg in the demo business. With
// --finalizar it WRITES the product in dev; without it, the last picture is
// the Queso blanco already in the catalogue (created on 2026-11-03).
//
// Steps 5 and 6 are the category (migration 184): the field under
// «Proveedor», then its sheet with «Lácteos» chosen. The demo business has
// «Lácteos» since 2026-11-03; with no categories the sheet shows its empty
// state instead of the list, and this script stops there.
import { go, click, type, shot, openMenu, escape, MENU, sleep, waitFor, DIALOG } from "../lib.mjs";
import { INPUT, LASTBTN } from "./_m.mjs";
const S = "crear-un-producto";
const STOCK = "js:document.querySelector('input[placeholder=\"0\"]')";
const COST = "js:document.querySelector('input[placeholder=\"00\"]')";
const CAMPO = "js:document.getElementById('producto_categoria')";
await go(`/productos`, 5000);
await shot(S, 1, "Crear producto");
await click("Crear producto", { wait: 5000 });
await type(INPUT("Escribe nombre"), "Queso blanco 1 kg");
await shot(S, 2, INPUT("Escribe nombre"), { blur: false });
await type(STOCK, "10");
await shot(S, 3, `${STOCK}.parentElement`);
await type(INPUT("¿Dónde"), "Lácteos del Centro");
await shot(S, 4, INPUT("¿Dónde"), { blur: false });
await shot(S, 5, CAMPO);
await click(CAMPO, { wait: 1500 });
await shot(S, 6, "js:[...document.querySelectorAll('[role=dialog] li button')].find(b=>b.textContent.startsWith('Lácteos'))?.closest('li')", { crop: 0, blur: false });
await click("js:[...document.querySelectorAll('[role=dialog] li button')].find(b=>b.textContent.startsWith('Lácteos'))", { scope: DIALOG, wait: 1000 });
await click(LASTBTN("Continuar"), { wait: 2500 });
await type(COST, "3", { wait: 1500 });
await shot(S, 7, `${COST}.closest('div').parentElement`);
await openMenu("js:[...document.querySelectorAll('button')].find(b=>/%|Otro \\(escribe/.test(b.textContent))");
await shot(S, 8, MENU, { blur: false });
await escape(); await sleep(500);
await shot(S, 9, "js:[...document.querySelectorAll('p')].find(e=>e.textContent.trim().startsWith('A ese precio tu ganancia'))");
await shot(S, 10, "Agregar");
await shot(S, 11, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Venta al mayor').parentElement");
await click(LASTBTN("Continuar"), { wait: 2500 });
await shot(S, 12, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Publicar producto en catálogo')).parentElement");
await shot(S, 13, "Adjuntar foto");
await click(LASTBTN("Continuar"), { wait: 2500 });
await shot(S, 14, LASTBTN("Crear producto"), { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click(LASTBTN("Crear producto"), { wait: 1000 });
  await waitFor("!location.pathname.endsWith('/nuevo')"); await sleep(4000);
} else {
  await go(`/productos`, 5000);
}
await shot(S, 15, "Abrir Queso blanco 1 kg", { crop: 0 });
