// «Atender un pedido del catálogo»: Karina Medina's order (demo business), the one the seed
// leaves unregistered. Stops at step 3/3 and prints it; --finalizar registers it, which WRITES
// a sale (and a new client) in dev: afterwards the order goes back to «Sin registrar» and the
// sale and the client are removed BY ID. It was Gustavo Rondón's order until v0.10.0, which
// has been registered since 2026-11-03.
import { go, click, shot, js, sleep, waitFor, openMenu, pick } from "../lib.mjs";
const S = "atender-un-pedido";
const ORDER = "3e2b135d-60d0-43d1-8ab0-345d53f6ff48";
await go(`/dashboard`, 4000);
await shot(S, 1, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Pedidos'))");
await go(`/productos/ordenes`, 5000);
await shot(S, 2, `js:document.querySelector('a[href$="${ORDER}"]')`);
await go(`/productos/ordenes/${ORDER}`, 5000);
await shot(S, 3, "Contactar vía WhatsApp");
await shot(S, 4, "Registrar pedido", { crop: 0 });
await click("Registrar pedido", { wait: 500 });
await waitFor("location.pathname.includes('/confirmar')"); await sleep(3000);
await shot(S, 5, "Cambiar");
// v0.11.0 (CT-181): «Agregar producto» under «Confirmar y continuar». Numbered 14 so the steps
// after it keep their pictures; nothing is added here, so the order stays as the seed left it.
await shot(S, 14, "Agregar producto", { crop: 0 });
await shot(S, 6, "Confirmar y continuar", { crop: 0 });
await click("Confirmar y continuar", { wait: 500 });
await waitFor("location.pathname.includes('/pago')"); await sleep(3000);
await shot(S, 7, "De contado");
// v0.10.0 (migration 214): «Método de pago», as in a sale.
await shot(S, 8, "js:document.getElementById('pago-metodo-USD').parentElement", { pad: 6 });
// v0.14.0: the method opens empty and is required, so one is chosen before «Pagar».
await openMenu("js:document.getElementById('pago-metodo-USD')");
await pick("Pago móvil");
await shot(S, 9, "Pagar $", { crop: 0 });
await click("Pagar $", { wait: 500 });
await waitFor("location.pathname.includes('/cliente')"); await sleep(3000);
await shot(S, 10, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Nombre del cliente').parentElement.parentElement", { crop: 0, pad: 2 });
await shot(S, 11, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Enviar notificaciones'))");
await shot(S, 12, "Registrar y finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Registrar y finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  // The bottom bar sits on top of «Compartir» at rest: bring the button to the middle.
  await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir')?.scrollIntoView({block:'center',behavior:'instant'})");
  await sleep(500);
  await shot(S, 13, "Compartir", { crop: 0 });
  console.log("url final:", await js("location.pathname + location.search"));
}
