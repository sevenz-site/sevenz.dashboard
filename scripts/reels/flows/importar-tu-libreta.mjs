// «Subir tu libreta con una foto» (Ayuda #16), with the owner's notebook photo of
// 2026-11-27 (Illustrations/Libretas/D-sin-totales.jpeg: Rosa Peña, four lines, no totals).
// The AI read is real (GEMINI). Rosa comes out as a new client, so the flow types an invented
// cédula and uploads her. SAVES a client and her movements in the dev demo: run between
// demo-state snapshot and restore.
import { join } from "node:path";
const PHOTO = join(process.cwd(), "..", "Illustrations", "Libretas", "D-sin-totales.jpeg");
const BTN = (t) => `[...document.querySelectorAll('button,a')].filter(b=>b.textContent.trim().startsWith(${JSON.stringify(t)})&&!b.disabled&&b.getBoundingClientRect().height>0).pop()`;
const PICK = "[...document.querySelectorAll('*')].filter(e=>e.textContent.trim().startsWith('Toca para elegir fotos')).pop().closest('label,button,div')";

export default async function importarTuLibreta(r) {
  await r.go("/import", 6000);
  await r.go("/dashboard", 4000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1000);

  r.mark("subir_libreta");
  await r.tap(r.FIND("Subir libreta"));
  await r.server(() => r.waitFor(PICK));
  await r.sleep(1600);

  r.mark("fotos");
  r.queueFile(PHOTO);
  await r.tap(PICK);
  await r.sleep(2600); // «En cola…» → «Leyendo con IA…», shown at real speed for a moment
  await r.server(() => r.waitFor(BTN("Ver resultados"), 180000));
  await r.sleep(1800);

  r.mark("ver_resultados");
  await r.tap(BTN("Ver resultados"));
  await r.server(() => r.waitFor(BTN("Todo en dólares")));
  await r.sleep(2000);

  r.mark("moneda");
  await r.tap(BTN("Todo en dólares"));
  await r.sleep(2200);

  r.mark("cliente");
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Rosa Peña'))");
  await r.waitFor("document.getElementById('detalle-documento')");
  await r.sleep(2200);

  r.mark("cedula");
  await r.tap("document.getElementById('detalle-documento')");
  await r.sleep(300);
  await r.type("15482930", 150);
  await r.sleep(1600);

  r.mark("subir");
  await r.tap(BTN("Subir este cliente"));
  await r.waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Subir')`);
  await r.sleep(1600);
  await r.tap("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Subir')");
  // «Subido desde libreta» is a label already on the sheet before uploading, so it proves
  // nothing: the upload is done when «Guardando…» is gone.
  await r.sleep(800);
  await r.server(() => r.waitFor("![...document.querySelectorAll('button')].some(b=>/Guardando/.test(b.textContent))", 90000));
  await r.sleep(3200);
  r.mark("end");
  await r.stopRecording();
}
