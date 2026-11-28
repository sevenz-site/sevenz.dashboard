// «Atender un pedido del catálogo» (Ayuda #5): the demo's unregistered order (Karina
// Medina's, left by the seed), registered de contado by «Pago móvil». SAVES a sale and a
// new client in the dev demo: run between demo-state snapshot and restore. The WhatsApp box
// is left unticked.
const ORDER = "3e2b135d-60d0-43d1-8ab0-345d53f6ff48";
const BTN = (t) => `[...document.querySelectorAll('button,a')].filter(b=>b.textContent.trim().startsWith(${JSON.stringify(t)})&&b.getBoundingClientRect().height>0).pop()`;

export default async function atenderUnPedido(r) {
  await r.go(`/productos/ordenes/${ORDER}`, 6000);
  if (!(await r.evaluate(`!!(${BTN("Registrar pedido")})`))) throw new Error("The demo order is not waiting to be registered");
  await r.go("/productos/ordenes", 5000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("tarjeta_pedidos");
  await r.tap("[...document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Pedidos'))");
  await r.server(() => r.waitFor(`document.querySelector('a[href$="${ORDER}"]')`));
  await r.sleep(1400);

  r.mark("pedido");
  await r.tap(`document.querySelector('a[href$="${ORDER}"]')`);
  await r.server(() => r.waitFor(BTN("Registrar pedido")));
  await r.sleep(2200);

  r.mark("registrar_pedido");
  await r.tap(BTN("Registrar pedido"));
  await r.server(() => r.waitFor("location.pathname.includes('/confirmar') && " + BTN("Confirmar y continuar")));
  await r.sleep(2200);

  r.mark("confirmar");
  await r.tap(BTN("Confirmar y continuar"));
  await r.server(() => r.waitFor("location.pathname.includes('/pago') && document.getElementById('pago-metodo-USD')"));
  await r.sleep(1800);

  r.mark("metodo");
  await r.menu("document.getElementById('pago-metodo-USD')");
  await r.sleep(1100);
  await r.pick("Pago móvil");
  await r.sleep(1200);

  r.mark("pagar");
  await r.tap(BTN("Pagar $"));
  await r.server(() => r.waitFor("location.pathname.includes('/cliente') && " + BTN("Registrar y finalizar")));
  await r.sleep(2400);

  r.mark("registrar_y_finalizar");
  await r.tap(BTN("Registrar y finalizar"));
  await r.server(() => r.waitFor("document.body.innerText.includes('registrada con éxito')", 40000));
  await r.sleep(2800);
  r.mark("end");
  await r.stopRecording();
}
