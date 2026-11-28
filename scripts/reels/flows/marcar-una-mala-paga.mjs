// «Marcar una mala paga» (Ayuda #8): marks Pedro with a reason, shows «Malas pagas», then
// unmarks him. SAVES in the dev demo (the flag and its history): run between demo-state
// snapshot and restore.
const TA = "document.querySelector('[role=dialog] textarea')";
const DLG_BTN = (t) => `[...document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})`;

export default async function marcarUnaMalaPaga(r) {
  const page = `/clients/${r.demo.clientes.pedro}`;
  await r.go("/malas-pagas", 5000);
  await r.go(page, 5000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("marcar");
  await r.tap(r.FIND("Marcar como mala paga"));
  await r.waitFor(TA);
  await r.sleep(1200);

  r.mark("motivo");
  await r.tap(TA);
  await r.sleep(300);
  await r.type("Lleva tres meses sin abonar y no contesta.", 55);
  await r.sleep(1200);

  r.mark("confirmar");
  await r.tap(DLG_BTN("Marcar como mala paga"));
  await r.server(() => r.waitFor(`!${TA}`));
  await r.sleep(1800);

  r.mark("lista");
  await r.go("/malas-pagas", 0);
  await r.server(() => r.waitFor("document.body.innerText.includes('Pedro')"));
  await r.sleep(2600);

  r.mark("quitar");
  await r.go(page, 0);
  await r.server(() => r.waitFor(r.FIND("Desmarcar como mala paga")));
  await r.sleep(1200);
  await r.tap(r.FIND("Desmarcar como mala paga"));
  await r.waitFor(DLG_BTN("Desmarcar"));
  await r.sleep(1400);
  r.mark("desmarcar");
  await r.tap(DLG_BTN("Desmarcar"));
  await r.server(() => r.waitFor(r.FIND("Marcar como mala paga")));
  await r.sleep(2000);
  r.mark("end");
  await r.stopRecording();
}
