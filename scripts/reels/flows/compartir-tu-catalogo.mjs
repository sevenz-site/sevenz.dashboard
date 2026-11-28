// «Compartir tu catálogo» (Ayuda #14): Catálogo, the «Publicar» switch, Compartir, Vista
// previa, and the catalogue the customer opens. The switch is shown, not flipped. Compartir
// goes to the share stub, not to a share sheet. Read-only in the app; opening the public
// catalogue may log a visit, so it runs between demo-state snapshot and restore.
export default async function compartirTuCatalogo(r) {
  await r.go(`/c/${r.demo.catalogToken}`, 6000);
  await r.go("/productos", 5000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1000);

  r.mark("catalogo");
  await r.tap("[...document.querySelectorAll('nav a')].find(a=>a.textContent.trim()==='Catálogo')");
  await r.server(() => r.waitFor(r.FIND("Publicar Arroz blanco 1 kg en el catálogo")));
  await r.sleep(1400);

  r.mark("publicar");
  await r.scrollTo(r.FIND("Publicar Arroz blanco 1 kg en el catálogo"));
  await r.sleep(2400);

  r.mark("compartir");
  await r.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await r.sleep(800);
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compartir'&&b.getBoundingClientRect().height>0)");
  await r.sleep(2000);

  r.mark("vista_previa");
  await r.menu(r.FIND("Más opciones"));
  await r.sleep(1300);
  await r.pick("Vista previa");
  await r.server(() => r.waitFor("location.pathname.startsWith('/c/') || document.body.innerText.includes('Mini abasto')"));
  await r.sleep(1600);
  await r.evaluate("document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay],[data-slot=sheet-overlay]').forEach(e=>e.remove()); document.body.style.pointerEvents=''; document.body.removeAttribute('data-scroll-locked');");
  await r.sleep(1600);
  r.mark("cliente_ve");
  await r.evaluate("window.scrollBy({ top: 520, behavior: 'smooth' })");
  await r.sleep(2800);
  r.mark("end");
  await r.stopRecording();
}
