// «Ver tus reportes» (Ayuda #12): Facturación (assistant, day's and month's close, the
// blocks, payment methods), Inventario («Avísame cuando queden»), Proveedores, Descargar.
// Read-only: the download menu is opened and closed, nothing is downloaded.
const SECTION = (id) => `document.getElementById(${JSON.stringify(id)})`;
const H2 = (t) => `[...document.querySelectorAll('h2')].find(h=>h.textContent.includes(${JSON.stringify(t)}))`;
const TAB = (t) => `[...document.querySelectorAll('a')].find(a=>a.textContent.trim()===${JSON.stringify(t)})`;
const BLOCK = (t) => `[...document.querySelectorAll('*')].filter(e=>e.children.length&&e.textContent.trim().startsWith(${JSON.stringify(t)})).pop()`;

export default async function verTusReportes(r) {
  await r.go("/reportes", 9000);
  await r.go("/reportes?tab=inventario", 8000);
  await r.go("/reportes?tab=proveedores", 8000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1000);

  r.mark("reportes");
  await r.tap("[...document.querySelectorAll('nav a')].find(a=>a.textContent.trim()==='Reportes')");
  await r.server(() => r.waitFor(SECTION("cierre-del-dia")));
  await r.sleep(2400);

  r.mark("asistente");
  await r.scrollTo(BLOCK("Asistente"), 240);
  await r.sleep(2600);
  r.mark("cierre_dia");
  await r.scrollTo(SECTION("cierre-del-dia"), 250);
  await r.sleep(2400);
  r.mark("cierre_mes");
  await r.scrollTo(SECTION("cierre-del-mes"), 250);
  await r.sleep(2200);
  r.mark("bloques");
  await r.scrollTo(SECTION("cartera"), 250);
  await r.sleep(2200);
  r.mark("metodos");
  await r.scrollTo(SECTION("metodos-de-pago"), 250);
  await r.sleep(2400);

  r.mark("inventario");
  await r.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await r.sleep(900);
  await r.tap(TAB("Inventario"));
  await r.server(() => r.waitFor(H2("Métricas del inventario")));
  await r.sleep(1800);
  r.mark("avisame");
  await r.scrollTo(BLOCK("Avísame cuando queden"));
  await r.sleep(2400);

  r.mark("proveedores");
  await r.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await r.sleep(900);
  await r.tap(TAB("Proveedores"));
  await r.server(() => r.waitFor(H2("Métricas de proveedores")));
  await r.sleep(2600);

  r.mark("descargar");
  await r.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await r.sleep(800);
  await r.menu(r.FIND("Descargar"));
  await r.sleep(2600);
  await r.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await r.sleep(600);
  r.mark("end");
  await r.stopRecording();
}
