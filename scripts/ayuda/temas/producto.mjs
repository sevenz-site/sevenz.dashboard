// «Crear un producto»: Queso blanco 1 kg in the demo business. With
// --finalizar it WRITES the product in dev.
import { go, click, type, shot, openMenu, escape, MENU, sleep, waitFor } from "../lib.mjs";
import { INPUT, LASTBTN } from "./_m.mjs";
const S = "crear-un-producto";
const STOCK = "js:document.querySelector('input[placeholder=\"0\"]')";
const COST = "js:document.querySelector('input[placeholder=\"00\"]')";
await go(`/productos`, 5000);
await shot(S, 1, "Crear producto");
await click("Crear producto", { wait: 5000 });
await type(INPUT("Escribe nombre"), "Queso blanco 1 kg");
await shot(S, 2, INPUT("Escribe nombre"), { blur: false });
await type(STOCK, "10");
await shot(S, 3, `${STOCK}.parentElement`);
await type(INPUT("¿Dónde"), "Lácteos del Centro");
await shot(S, 4, INPUT("¿Dónde"), { blur: false });
await click(LASTBTN("Continuar"), { wait: 2500 });
await type(COST, "3", { wait: 1500 });
await shot(S, 5, `${COST}.closest('div').parentElement`);
await openMenu("js:[...document.querySelectorAll('button')].find(b=>/%|Otro \\(escribe/.test(b.textContent))");
await shot(S, 6, MENU, { blur: false });
await escape(); await sleep(500);
await shot(S, 7, "js:[...document.querySelectorAll('p')].find(e=>e.textContent.trim().startsWith('A ese precio tu ganancia'))");
await shot(S, 8, "Agregar");
await shot(S, 9, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Venta al mayor').parentElement");
await click(LASTBTN("Continuar"), { wait: 2500 });
await shot(S, 10, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Publicar producto en catálogo')).parentElement");
await shot(S, 11, "Adjuntar foto");
await click(LASTBTN("Continuar"), { wait: 2500 });
await shot(S, 12, LASTBTN("Crear producto"), { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click(LASTBTN("Crear producto"), { wait: 1000 });
  await waitFor("!location.pathname.endsWith('/nuevo')"); await sleep(4000);
  await shot(S, 13, "Abrir Queso blanco 1 kg", { crop: 0 });
}
