// «Registrar una devolución» (Ayuda #7): one Harina back from the fiado that
// registrar-un-fiado left on Julia Ramírez (it has an abono after registrar-un-abono, so the
// money question shows), refunded by «Pago móvil». SAVES in the dev demo: run between
// demo-state snapshot and restore, after those two flows.
const MORE = `document.querySelector('button[aria-label="Más opciones de Harina de maíz 1 kg"]')`;
const DIALOG_BTN = (t) => `[...document.querySelectorAll('[data-slot=dialog-content] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(t)}))`;

export default async function registrarUnaDevolucion(r) {
  // The newest fiado of Julia: the one registrar-un-fiado wrote.
  const page = `/clients/${r.demo.clientes.julia}`;
  await r.go(page, 6000);
  const href = await r.evaluate("[...document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Fiado'))?.getAttribute('href')");
  if (!href) throw new Error("No fiado on Julia's page");
  await r.go(href, 6000);
  await r.go(page, 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("abrir_fiado");
  await r.tap(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')===${JSON.stringify(href)})`);
  await r.server(() => r.waitFor(MORE));
  await r.sleep(1800);

  r.mark("tres_puntos");
  await r.menu(MORE);
  await r.sleep(1300);
  r.mark("registrar_devolucion");
  await r.pick("Registrar devolución");
  await r.server(() => r.waitFor("document.querySelector('[data-slot=dialog-content]')"));
  await r.sleep(2800);

  // The method only shows when a button hands money back. With nothing paid on this fiado
  // the dialog offers «Descontar … de la deuda» alone, which the guide also describes.
  if (await r.evaluate("!!document.getElementById('devolucion-metodo')")) {
    r.mark("metodo");
    await r.menu("document.getElementById('devolucion-metodo')");
    await r.sleep(1200);
    await r.pick("Pago móvil");
    await r.sleep(1400);
  }

  r.mark("confirmar");
  const ACTION = `${DIALOG_BTN("Devolver")} || ${DIALOG_BTN("Descontar")}`;
  r.note("action", await r.evaluate(`(${ACTION})?.textContent.trim()`));
  await r.tap(`(${ACTION})`);
  await r.server(() => r.waitFor("location.search.includes('registrada=1')", 40000));
  await r.sleep(3000);

  r.mark("fiado_marcado");
  await r.go(href, 0);
  await r.server(() => r.waitFor("[...document.querySelectorAll('main *')].some(e=>!e.children.length&&/^Devuelto/.test(e.textContent.trim()))"));
  await r.sleep(800);
  await r.scrollTo("[...document.querySelectorAll('main *')].find(e=>!e.children.length&&/^Devuelto/.test(e.textContent.trim()))");
  await r.sleep(2400);

  r.mark("historial");
  await r.go(page, 0);
  await r.server(() => r.waitFor("[...document.querySelectorAll('main li')].some(l=>l.innerText.includes('Devolución'))"));
  await r.sleep(600);
  await r.scrollTo("[...document.querySelectorAll('main li')].find(l=>l.innerText.includes('Devolución'))");
  await r.sleep(2600);
  r.mark("end");
  await r.stopRecording();
}
