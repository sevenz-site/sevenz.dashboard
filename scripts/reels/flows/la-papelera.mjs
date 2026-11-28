// «La papelera» (Ayuda #17): Carmen Linares (no debt) to the bin and back with «Restaurar».
// SAVES in the dev demo: run between demo-state snapshot and restore.
const DLG_BTN = (t) => `[...document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})`;

export default async function laPapelera(r) {
  const page = `/clients/${r.demo.clientes.carmen}`;
  await r.go("/papelera", 5000);
  await r.go(page, 5000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("menu");
  await r.menu(r.FIND("Más opciones"));
  await r.sleep(1300);
  await r.pick("Mover a papelera");
  await r.waitFor(DLG_BTN("Mover a papelera"));
  await r.sleep(1500);

  r.mark("confirmar");
  await r.tap(DLG_BTN("Mover a papelera"));
  await r.server(() => r.waitFor("!location.pathname.startsWith('/clients/')", 30000));
  await r.sleep(2000);

  r.mark("papelera");
  await r.tap(r.FIND("Abrir menú"));
  await r.sleep(1300);
  await r.tap("[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Papelera')");
  await r.server(() => r.waitFor(r.FIND("Restaurar")));
  await r.sleep(2000);

  r.mark("restaurar");
  await r.tap(r.FIND("Restaurar"));
  await r.sleep(1500);
  if (await r.evaluate(`!!${DLG_BTN("Restaurar")}`)) {
    await r.tap(DLG_BTN("Restaurar"));
  }
  await r.server(() => r.waitFor(`!${r.FIND("Restaurar")}`, 30000));
  await r.sleep(2400);
  r.mark("end");
  await r.stopRecording();
}
