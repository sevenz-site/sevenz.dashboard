// «Crear un producto» (Ayuda #13): Queso de mano 1 kg, the four steps, «Crear producto».
// SAVES a product in the dev demo: run between demo-state snapshot and restore. No photo is
// uploaded (the tile is shown, as in the Ayuda capture).
const INPUT = (ph) => `[...document.querySelectorAll('input,textarea')].find(i=>(i.placeholder||'').startsWith(${JSON.stringify(ph)}))`;
const LASTBTN = (t) => `[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;
const LABEL = (t) => `[...document.querySelectorAll('label')].find(l=>l.textContent.includes(${JSON.stringify(t)}))`;

export default async function crearUnProducto(r) {
  await r.go("/productos/nuevo", 6000);
  await r.go("/productos", 5000);

  await r.startRecording();
  r.mark("start");
  await r.sleep(1200);

  r.mark("crear");
  await r.tap(r.FIND("Crear producto"));
  await r.server(() => r.waitFor(INPUT("Escribe nombre")));
  await r.sleep(1200);

  r.mark("nombre");
  await r.tap(INPUT("Escribe nombre"));
  await r.sleep(200);
  await r.type("Queso de mano 1 kg", 80);
  await r.sleep(700);
  r.mark("inventario");
  await r.tap("document.querySelector('input[placeholder=\"0\"]')");
  await r.sleep(200);
  await r.type("12", 200);
  await r.sleep(700);
  r.mark("proveedor");
  await r.tap(INPUT("¿Dónde"));
  await r.sleep(200);
  await r.type("Lácteos del Centro", 80);
  await r.sleep(800);

  r.mark("categoria");
  await r.tap("document.getElementById('producto_categoria')");
  await r.waitFor("[...document.querySelectorAll('[role=dialog] li button')].some(b=>b.textContent.startsWith('Lácteos'))");
  await r.sleep(1300);
  await r.tap("[...document.querySelectorAll('[role=dialog] li button')].find(b=>b.textContent.startsWith('Lácteos'))");
  await r.sleep(1200);
  r.mark("continuar_1");
  await r.tap(LASTBTN("Continuar"));
  await r.server(() => r.waitFor("document.querySelector('input[placeholder=\"00\"]')"));
  await r.sleep(1200);

  r.mark("costo");
  await r.tap("document.querySelector('input[placeholder=\"00\"]')");
  await r.sleep(200);
  await r.type("4", 200);
  await r.sleep(1200);
  r.mark("margen");
  await r.scrollTo("[...document.querySelectorAll('p')].find(e=>e.textContent.trim().startsWith('A ese precio tu ganancia'))");
  await r.sleep(2000);
  r.mark("mayor");
  await r.scrollTo(`${LABEL("Venta al mayor")}`);
  await r.sleep(1600);
  r.mark("continuar_2");
  await r.tap(LASTBTN("Continuar"));
  await r.server(() => r.waitFor(LABEL("Publicar producto en catálogo")));
  await r.sleep(1600);

  r.mark("fotos");
  await r.scrollTo("[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='Agregar')");
  await r.sleep(1400);
  r.mark("descripcion");
  await r.tap("document.querySelector('textarea')");
  await r.sleep(200);
  await r.type("Queso de mano fresco, hecho esta semana.", 55);
  await r.sleep(1000);
  r.mark("continuar_3");
  await r.tap(LASTBTN("Continuar"));
  await r.server(() => r.waitFor(LASTBTN("Crear producto")));
  await r.sleep(2200);

  r.mark("crear_producto");
  await r.tap(LASTBTN("Crear producto"));
  await r.server(() => r.waitFor("!location.pathname.endsWith('/nuevo')", 40000));
  await r.sleep(2800);
  r.mark("end");
  await r.stopRecording();
}
