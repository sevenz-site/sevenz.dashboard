// «Filtrar el historial por fecha» (Ayuda #10), on Julia Ramírez: «Últimos 7 días», then
// «Quitar fecha». Read-only. Run after registrar-un-fiado / registrar-un-abono so the last
// 7 days have something to show.
const ROW = "[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Estado')?.parentElement";
const CHIP = `${ROW}?.children[1]`;
const IN_SHEET = (t) => `[...document.querySelectorAll('[data-slot=sheet-content] button')].find(b=>b.innerText.trim()===${JSON.stringify(t)})`;

export default async function filtrarElHistorial(r) {
  const page = `/clients/${r.demo.clientes.julia}`;
  await r.go(page, 6000);
  await r.go(page, 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("historial");
  await r.scrollTo(ROW, 260);
  await r.sleep(2000);

  r.mark("fecha");
  await r.tap(CHIP);
  await r.sleep(1600);

  r.mark("atajo");
  await r.tap(IN_SHEET("Últimos 7 días"));
  await r.sleep(1200);
  await r.scrollTo(ROW, 260);
  await r.sleep(2600);

  r.mark("quitar");
  await r.tap(CHIP);
  await r.sleep(1200);
  await r.evaluate("document.querySelector('[data-slot=sheet-content]').scrollTo({top: 9999, behavior: 'smooth'})");
  await r.sleep(1000);
  await r.tap(IN_SHEET("Quitar fecha"));
  await r.sleep(2200);
  r.mark("end");
  await r.stopRecording();
}
