// «Vender sin elegir producto» (Ayuda #2): Registrar › Fiado o venta › Omitir, $5 with a
// description, Continuar, and the Pago step. Stops there, as the guide does («y sigue como en
// cualquier venta»): nothing is saved.
export default async function venderSinProducto(r) {
  await r.go("/ventas/nueva", 6000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("registrar");
  await r.tap(r.FIND("Registrar"));
  await r.sleep(1300);
  r.mark("fiado_o_venta");
  await r.tap(r.FIND("Fiado o venta", r.DIALOG));
  await r.server(() => r.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Omitir')"));
  await r.sleep(1300);

  r.mark("omitir");
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Omitir')");
  await r.server(() => r.waitFor("document.querySelector('#venta-monto-USD')"));
  await r.sleep(1400);

  r.mark("monto");
  await r.tap("document.querySelector('#venta-monto-USD')");
  await r.sleep(300);
  await r.type("5", 200);
  await r.sleep(1600);

  r.mark("otra_moneda");
  await r.scrollTo(r.FIND("Agregar monto en Euro"));
  await r.sleep(1800);

  r.mark("descripcion");
  await r.tap("document.querySelector('#venta-descripcion')");
  await r.sleep(300);
  await r.type("Recarga de teléfono", 90);
  await r.sleep(1200);

  r.mark("continuar");
  await r.tap("[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Continuar'&&b.getBoundingClientRect().height>0).pop()");
  await r.server(() => r.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Pagar')"));
  await r.sleep(1600);

  r.mark("pagar");
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pagar')");
  await r.sleep(2600);
  r.mark("end");
  await r.stopRecording();
}
