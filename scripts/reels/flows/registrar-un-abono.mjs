// «Registrar un abono» (Ayuda #4): $4 from Julia Ramírez, from her page, method «Pago móvil».
// Run right after registrar-un-fiado, so she has two open fiados and the split shows. SAVES
// in the dev demo: run between demo-state snapshot and restore. Consent box left unticked.
const LABEL = (t) => `[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(t)})`;
const BTN = (t) => `[...document.querySelectorAll('button')].filter(b=>b.textContent.trim().startsWith(${JSON.stringify(t)})&&b.getBoundingClientRect().height>0).pop()`;

export default async function registrarUnAbono(r) {
  const page = `/clients/${r.demo.clientes.julia}`;
  await r.go(page, 6000);
  await r.go(page, 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1400);

  r.mark("agregar_abono");
  await r.tap(r.FIND("Agregar abono"));
  const AMOUNT = "document.querySelector('input[placeholder=\"00\"]')";
  await r.server(() => r.waitFor(AMOUNT));
  await r.sleep(1500);

  r.mark("monto");
  await r.tap(AMOUNT);
  await r.sleep(300);
  await r.type("4", 220); // a plain number, not a cents mask: «4» is $4
  await r.sleep(1200);

  r.mark("moneda");
  await r.menu(r.FIND("Dólares"));
  await r.sleep(1600);
  await r.pick("Dólares");
  await r.sleep(1000);

  r.mark("reparto");
  await r.scrollTo("[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Así se reparte'))", 120);
  await r.sleep(2200);

  r.mark("metodo");
  const METHOD = `document.getElementById(${LABEL("Método de pago")}.htmlFor)`;
  await r.menu(METHOD);
  await r.sleep(1200);
  await r.pick("Pago móvil");
  await r.sleep(1200);

  r.mark("descripcion");
  await r.tap("document.getElementById('reparto-descripcion')");
  await r.sleep(300);
  await r.type("Pago de la semana", 90);
  await r.sleep(1000);

  r.mark("repartir_manual");
  await r.tap(r.FIND("Repartir manualmente"));
  await r.sleep(2400);
  await r.evaluate("document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  await r.sleep(1000);

  r.mark("pagar_y_finalizar");
  await r.tap(BTN("Pagar y finalizar"));
  await r.server(() => r.waitFor("document.body.innerText.includes('registrada con éxito')", 40000));
  await r.sleep(1500);
  r.mark("listo");
  await r.scrollTo("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir')");
  await r.sleep(1000);
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir')");
  await r.sleep(1800);
  await r.saveShared("shared-card.png");
  r.mark("end");
  await r.stopRecording();
}
