// «Atender un pedido del catálogo»: Gustavo Rondón's order (demo business).
// Stops at step 3/3 and prints it; --finalizar registers it, which WRITES a
// sale (and a new client) in dev.
import { go, click, shot, js, sleep, waitFor } from "../lib.mjs";
const S = "atender-un-pedido";
const ORDER = "44ebd660-f974-4de8-bcc6-b7311c337de2";
await go(`/dashboard`, 4000);
await shot(S, 1, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Pedidos'))");
await go(`/productos/ordenes`, 5000);
await shot(S, 2, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Gustavo'))");
await go(`/productos/ordenes/${ORDER}`, 5000);
await shot(S, 3, "Contactar vía WhatsApp");
await shot(S, 4, "Registrar pedido", { crop: 0 });
await click("Registrar pedido", { wait: 500 });
await waitFor("location.pathname.includes('/confirmar')"); await sleep(3000);
await shot(S, 5, "Cambiar");
await shot(S, 6, "Confirmar y continuar", { crop: 0 });
await click("Confirmar y continuar", { wait: 500 });
await waitFor("location.pathname.includes('/pago')"); await sleep(3000);
await shot(S, 7, "De contado");
await shot(S, 8, "Pagar $", { crop: 0 });
await click("Pagar $", { wait: 500 });
await waitFor("location.pathname.includes('/cliente')"); await sleep(3000);
await shot(S, 9, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Nombre del cliente').parentElement.parentElement", { crop: 0, pad: 2 });
await shot(S, 10, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Enviar notificaciones'))");
await shot(S, 11, "Registrar y finalizar", { crop: 0 });
if (process.argv.includes("--finalizar")) {
  await click("Registrar y finalizar", { wait: 1000 });
  await waitFor("document.body.innerText.includes('registrada con éxito')"); await sleep(1500);
  await js("scrollTo(0,0)");
  await shot(S, 12, "Compartir", { crop: 0 });
}
