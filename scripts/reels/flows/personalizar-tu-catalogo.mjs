// «Personalizar tu catálogo» (Ayuda #15): colour, brand description, a cover, welcome,
// WhatsApp box, Instagram link, «Ver cómo queda», «Guardar cambios», and the customer's
// catalogue. SAVES branding and uploads a cover in the dev demo: run between demo-state
// snapshot and restore (which puts the demo's branding back and removes the cover file).
//
// The cover is the drawn banner of the Ayuda capture (scripts/ayuda/temas/personalizar.mjs),
// saved as assets/portada-demo.jpg: shelves in a gradient, no real shop. It goes in through
// the page's own file picker, the way an owner's photo would.
const HEX = "document.querySelector('input[placeholder=\"#272727\"]')";

export default async function personalizarTuCatalogo(r) {
  await r.go("/productos", 5000);
  await r.go(`/c/${r.demo.catalogToken}`, 5000);
  await r.go("/productos", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1000);

  r.mark("menu");
  await r.menu(r.FIND("Más opciones"));
  await r.sleep(1200);
  await r.pick("Personalizar catálogo");
  await r.server(() => r.waitFor(HEX));
  await r.sleep(1400);

  r.mark("color");
  await r.tap(HEX);
  await r.evaluate(`(()=>{const el=${HEX}; el.select && el.select();})()`);
  await r.sleep(200);
  await r.type("#1E6B52", 120);
  await r.sleep(1000);

  r.mark("descripcion");
  await r.tap("document.getElementById('brand-description')");
  await r.sleep(200);
  await r.type("Víveres y charcutería para el barrio desde 2015.", 45);
  await r.sleep(900);

  r.mark("portada");
  r.queueFile(r.asset("portada-demo.jpg"));
  await r.tap(r.FIND("Subir portada"));
  await r.server(() => r.waitFor(r.FIND("Cambiar portada"), 30000));
  await r.sleep(1600);

  r.mark("bienvenida");
  await r.tap("document.getElementById('catalog-welcome')");
  await r.sleep(200);
  await r.type("¡Bienvenido! Haz tu pedido y te lo tenemos listo.", 45);
  await r.sleep(900);

  r.mark("whatsapp");
  await r.tap("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Contactar vía WhatsApp'))");
  await r.sleep(1300);

  r.mark("enlace");
  await r.menu(r.FIND("Qué enlace es"));
  await r.sleep(1000);
  await r.pick("Instagram");
  await r.sleep(800);
  await r.tap("document.getElementById('catalog-link-url')");
  await r.sleep(200);
  await r.type("https://instagram.com/miniabastoelchino", 35);
  await r.sleep(900);

  r.mark("ver_como_queda");
  await r.tap(r.FIND("Ver cómo queda"));
  await r.sleep(3400);
  await r.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await r.sleep(900);

  r.mark("guardar");
  await r.tap(r.FIND("Guardar cambios"));
  await r.server(() => r.sleep(4000));
  r.mark("cliente_ve");
  await r.go(`/c/${r.demo.catalogToken}`, 0);
  await r.server(() => r.waitFor("document.body.innerText.includes('Bienvenido')"));
  await r.evaluate("document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay],[data-slot=sheet-overlay]').forEach(e=>e.remove()); document.body.style.pointerEvents=''; document.body.removeAttribute('data-scroll-locked');");
  await r.sleep(3200);
  r.mark("end");
  await r.stopRecording();
}
