// «Mi negocio: tus datos» (Ayuda #18): menu › Mi negocio, then down the form: logo,
// business data, the catalogue address box, Personalizar, payment methods, notifications
// (opened to show «Consejos de Sevenz»), barcodes, account security, «Guardar cambios».
// Read-only: nothing is changed or saved (a tick would make the form dirty, see
// scripts/ayuda/temas/negocio.mjs).
const LABEL = (t) => `[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(t)})`;
const H2 = (t) => `[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()===${JSON.stringify(t)})`;
const LEAF = (t) => `[...document.querySelectorAll('*')].filter(e=>!e.children.length&&e.textContent.trim()===${JSON.stringify(t)}).pop()`;

export default async function miNegocio(r) {
  await r.go("/profile", 6000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1000);

  r.mark("menu");
  await r.tap(r.FIND("Abrir menú"));
  await r.sleep(1300);
  await r.tap("[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Mi negocio')");
  await r.server(() => r.waitFor(r.FIND("Subir logo")));
  await r.sleep(2200);

  r.mark("datos");
  await r.scrollTo(LABEL("Nombre del negocio"), 160);
  await r.sleep(2400);
  r.mark("direccion");
  await r.scrollTo("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Mostrar mi dirección en el catálogo'))");
  await r.sleep(2000);
  r.mark("personalizar");
  await r.scrollTo(H2("Personalizar catálogo"), 200);
  await r.sleep(1800);
  r.mark("metodos");
  await r.scrollTo(r.FIND("Agregar método de pago"));
  await r.sleep(2000);
  r.mark("notificaciones");
  const NOTICES = `${LEAF("Avisos por WhatsApp activados")}?.closest('button')`;
  await r.tap(NOTICES);
  await r.sleep(2400);
  await r.tap(NOTICES);
  await r.sleep(900);
  r.mark("codigos");
  await r.scrollTo(`${LEAF("Trabajar con códigos de barras")}`);
  await r.sleep(1800);
  r.mark("seguridad");
  await r.scrollTo(r.FIND("Cambiar contraseña"));
  await r.sleep(2400);
  r.mark("end");
  await r.stopRecording();
}
