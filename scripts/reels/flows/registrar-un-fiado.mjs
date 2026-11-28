// «Registrar una venta o un fiado» (Ayuda #1): two products, fiado to Julia Ramírez with a
// 7-day term. SAVES a sale in the dev demo: run between demo-state snapshot and restore.
// The WhatsApp consent box is left unticked, as the guide says (only with the client's yes).
const BTN = (t, scope = "document") => `[...${scope}.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;

export default async function registrarUnFiado(r) {
  await r.go("/dashboard", 6000);
  await r.go("/ventas/nueva", 6000); // compile the wizard once, unrecorded
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1400);

  r.mark("registrar");
  await r.tap(r.FIND("Registrar"));
  await r.sleep(1400);
  r.mark("fiado_o_venta");
  await r.tap(r.FIND("Fiado o venta", r.DIALOG));
  await r.server(() => r.waitFor(`${r.FIND("Ver Harina de maíz 1 kg")}`));
  await r.sleep(1400);

  r.mark("producto_1");
  await r.tap(r.FIND("Ver Harina de maíz 1 kg"));
  await r.sleep(1300);
  r.mark("agregar_1");
  await r.tap(r.FIND("Agregar $", r.DIALOG));
  await r.sleep(1200);
  r.mark("producto_2");
  await r.tap(r.FIND("Ver Arroz blanco 1 kg"));
  await r.sleep(1300);
  r.mark("agregar_2");
  await r.tap(r.FIND("Agregar $", r.DIALOG));
  await r.sleep(1200);

  r.mark("ver_carrito");
  await r.tap(r.FIND("Ver carrito"));
  await r.sleep(1800);
  r.mark("ir_a_pago");
  await r.tap(r.FIND("Ir a pago"));
  await r.server(() => r.waitFor(BTN("Pagar")));
  await r.sleep(1500);

  r.mark("pagar_tarjeta");
  await r.tap(BTN("Pagar"));
  await r.sleep(1800);
  r.mark("fiado_o_credito");
  await r.tap(r.FIND("Fiado o crédito", r.DIALOG));
  await r.sleep(1400);
  r.mark("plazo");
  await r.scrollTo(r.FIND("7 días", r.DIALOG));
  await r.sleep(700);
  await r.menu(r.FIND("7 días", r.DIALOG));
  await r.sleep(1000);
  await r.pick("7 días");
  await r.sleep(700);
  await r.waitFor("!document.querySelector('[role=listbox]')", 4000);
  await r.sleep(400);
  r.mark("pagar_fiado");
  await r.scrollTo(BTN("Pagar", "document.querySelector('[role=dialog]')"));
  await r.sleep(800);
  await r.tap(BTN("Pagar", "document.querySelector('[role=dialog]')"));
  await r.sleep(1800);

  r.mark("continuar");
  await r.tap(r.FIND("Continuar"));
  const SEARCH = "document.querySelector('input[placeholder=\"Buscar cliente\"]')";
  await r.server(() => r.waitFor(SEARCH));
  await r.sleep(1300);

  r.mark("buscar_cliente");
  await r.tap(SEARCH);
  await r.sleep(400);
  await r.type("Julia", 180);
  await r.server(() => r.waitFor(r.FIND("Julia Ramírez")));
  await r.sleep(900);
  r.mark("elegir_cliente");
  await r.tap(r.FIND("Julia Ramírez"));
  await r.sleep(1800);

  r.mark("finalizar");
  await r.tap(r.FIND("Finalizar"));
  await r.server(() => r.waitFor("document.body.innerText.includes('registrada con éxito')", 40000));
  await r.sleep(1200);
  r.mark("listo");
  await r.scrollTo(BTN("Compartir"));
  await r.sleep(1200);
  await r.tap(BTN("Compartir"));
  await r.sleep(1800);
  await r.saveShared("shared-card.png");
  r.mark("end");
  await r.stopRecording();
  r.note("url", await r.evaluate("location.pathname + location.search"));
}
