// The rate calculator, following sevenz.site/ayuda/calculadora-de-tasa step by step:
// Inicio → Calcular → currency → «Tú pones» → «Tú cobras» → Invertir → Compartir →
// the 90-day BCV table. Read-only: nothing is written to the database.
export default async function calculadoraDeTasa(r) {
  // Warm-up, not recorded: compiles the route and opens the page once.
  await r.go("/dashboard", 6000);
  await r.go("/dashboard", 4000);
  await r.evaluate("window.scrollTo(0,0)");

  await r.startRecording();
  r.mark("start");
  await r.sleep(1600);

  r.mark("scroll_inicio");
  await r.evaluate(`(() => { const e = ${r.FIND("Calcular")}; const b = e.getBoundingClientRect(); window.scrollBy({ top: b.top - 330, behavior: 'smooth' }); })()`);
  await r.sleep(1300);

  r.mark("tap_calcular");
  await r.tap(r.FIND("Calcular"));
  await r.sleep(1500);
  await r.assert("!!document.querySelector('[role=dialog]')", "the calculator sheet opened");

  r.mark("tap_moneda");
  await r.sleep(400);
  await r.tap(`[...document.querySelectorAll('[role=dialog] button[aria-pressed]')].find(b=>b.textContent.includes('Dólares'))`);
  await r.sleep(1100);

  r.mark("tap_pones");
  await r.tap("document.getElementById('calc-put')");
  await r.sleep(500);
  r.mark("typing");
  await r.type("2000");
  await r.sleep(600);

  r.mark("cobras");
  await r.sleep(2400);

  r.mark("tap_invertir");
  await r.tap(r.FIND("Invertir", r.DIALOG));
  await r.sleep(2600);

  r.mark("tap_compartir");
  await r.tap(r.FIND("Compartir", r.DIALOG));
  await r.sleep(1800);
  await r.saveShared("shared-card.png");

  r.mark("scroll_historial");
  await r.scrollIntoView(r.FIND("Filtrar por fecha", r.DIALOG));
  await r.sleep(2600);

  r.mark("end");
  await r.stopRecording();

  // What the screen showed, for the report: the figures come from the dev branch.
  r.note("values", await r.evaluate(`[...document.querySelectorAll('[role=dialog] input')].map(i=>i.value)`));
  r.note("stamp", await r.evaluate(`(document.querySelector('[role=dialog]')?.innerText||'').split('\\n').filter(l=>/Tasa BCV del|1 Dólar/.test(l))`));
}
