// «Ver el puntaje del cliente» (Ayuda #9): Julia's «Puntaje de crédito», and the
// «Mejores pagadores» list in Reportes from the guide's closing line. Read-only.
const H2 = (t) => `[...document.querySelectorAll('h2')].find(h=>h.textContent.includes(${JSON.stringify(t)}))`;

export default async function verElPuntaje(r) {
  const page = `/clients/${r.demo.clientes.julia}`;
  await r.go("/reportes", 8000);
  await r.go(page, 5000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("puntaje");
  await r.scrollTo(H2("Puntaje de crédito"), 90);
  await r.sleep(3600);

  // The client's page has no bottom bar: back to Inicio first, then «Reportes» in the bar.
  r.mark("volver");
  await r.tap("document.querySelector('a[aria-label^=\"Volver\"],button[aria-label^=\"Volver\"]') || document.querySelector('header a, header button')");
  await r.server(() => r.waitFor("[...document.querySelectorAll('nav a')].some(a=>a.textContent.trim()==='Reportes')"));
  await r.sleep(1000);
  r.mark("reportes");
  await r.tap("[...document.querySelectorAll('nav a')].find(a=>a.textContent.trim()==='Reportes')");
  await r.server(() => r.waitFor(`document.getElementById('mejores-pagadores') || ${H2("Mejores pagadores")}`));
  await r.sleep(1200);
  r.mark("mejores_pagadores");
  await r.scrollTo(`document.getElementById('mejores-pagadores') || ${H2("Mejores pagadores")}`, 200);
  await r.sleep(3400);
  r.mark("end");
  await r.stopRecording();
}
