// «Compartir el enlace del cliente» (Ayuda #6), on Julia Ramírez: «Compartir saldo vía
// WhatsApp» is shown, not pressed (it would open WhatsApp with her number); «Compartir
// enlace» from the menu; the page her client sees; the bell. Opening her link writes a
// «link opened» notice in the dev demo: run between demo-state snapshot and restore.
export default async function compartirElLink(r) {
  const page = `/clients/${r.demo.clientes.julia}`;
  await r.go(`/s/${r.demo.shareToken}`, 6000);
  await r.go("/notificaciones", 5000);
  await r.go(page, 5000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("boton_whatsapp");
  await r.scrollTo(r.FIND("Compartir saldo vía WhatsApp"));
  await r.sleep(2200);

  r.mark("menu");
  await r.menu(r.FIND("Más opciones"));
  await r.sleep(1300);
  r.mark("compartir_enlace");
  await r.pick("Compartir enlace");
  await r.sleep(2200);

  r.mark("vista_cliente");
  await r.go(`/s/${r.demo.shareToken}`, 0);
  await r.server(() => r.waitFor("document.body.innerText.includes('Julia')"));
  await r.sleep(1800);
  // Close the client-side pop-ups for the picture only: accepting would write for her.
  await r.evaluate("document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay],[data-slot=sheet-overlay]').forEach(e=>e.remove()); document.body.style.pointerEvents=''; document.body.removeAttribute('data-scroll-locked');");
  await r.sleep(1600);
  await r.evaluate("window.scrollBy({ top: 420, behavior: 'smooth' })");
  await r.sleep(2400);

  r.mark("notificaciones");
  await r.go("/notificaciones", 0);
  // The bottom bar alone already passes a length test: wait for the notices themselves.
  await r.server(() => r.waitFor("document.querySelectorAll('main li, main article, main a[href]').length > 3"));
  await r.sleep(2600);
  r.mark("end");
  await r.stopRecording();
}
