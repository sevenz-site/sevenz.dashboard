// «Escanear códigos de barras» (v0.13.0, CT-182), plus the new step of «Mi negocio» and the
// re-take of «Registrar un abono» step 5 (the abono now opens on «Pago móvil»). Demo business.
//
// IT WRITES IN DEV, and undoes it: it turns on the demo's «Trabajar con códigos de barras» (the
// first step is pressing that switch), puts one code on «Arroz» so the scanner has something to
// find, and at the end deletes that code BY ID and puts the switch back as it found it. Nothing
// is sold: the sale step stops at the cart.
//
// THE CAMERA IS DRAWN BY THE SCRIPT. Headless Chrome has no camera, and its built-in fake one is
// a green test pattern that would teach nothing on a public page. So `getUserMedia` is replaced,
// in the page, by a canvas showing a barcode on a light shelf. The reads themselves come from the
// gun's path: a burst of keystrokes ending in Enter, which is what a gun types and what the app's
// listener reads on any screen.
import { go, click, type, shot, js, sleep, waitFor } from "../lib.mjs";
import { M } from "./_m.mjs";

import { admin } from "./_admin.mjs";
import { CAMERA } from "./_camera.mjs";

const S = "escanear-codigos-de-barras";
const CONOCIDO = "7591234567894";
const NUEVO = "7591058001109";
const gun = (code) => js(`(()=>{const t=document.activeElement||document.body;for(const k of ${JSON.stringify(code)}.split('').concat('Enter')){t.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));}return 1})()`);
const { data: antes } = await admin.from("owners").select("barcodes_enabled").eq("id", M.ownerId).single();
let filaCodigo = null;
try {
  // ── 1. The switch, in Mi negocio (also step 12 of «Mi negocio»). ──────────
  await admin.from("owners").update({ barcodes_enabled: false }).eq("id", M.ownerId);
  await go("/profile", 5000);
  // Mi negocio renders its form twice (phone and desktop layouts, one hidden): the visible one.
  const SWITCH = "js:[...document.querySelectorAll('#codigos-de-barras')].find(b=>b.getBoundingClientRect().height>0)";
  const CARD = "js:[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Códigos de barras'&&h.getBoundingClientRect().height>0).parentElement";
  await js(`(()=>{${CARD.slice(3)}.scrollIntoView({block:'center',behavior:'instant'});return 1})()`);
  await sleep(500);
  await shot(S, 1, SWITCH, { pad: 6 });
  await shot("mi-negocio", 12, CARD, { pad: 6 });
  await click(SWITCH, { wait: 3000 });
  await waitFor("document.body.innerText.includes('Ya tienes el botón para escanear')||document.body.innerText.includes('Códigos de barras activados')");
  await sleep(1500);

  // ── 2. The scan button on Inicio. ──────────────────────────────────────────
  await go("/dashboard", 5000);
  await shot(S, 2, "js:document.querySelector('[aria-label=\"Escanear código\"]')", { pad: 6 });

  // ── 3. The viewer, with the torch. ─────────────────────────────────────────
  await js(CAMERA);
  await click("js:document.querySelector('[aria-label=\"Escanear código\"]')", { wait: 3500 });
  await shot(S, 3, "js:document.querySelector('[aria-label=\"Encender la linterna\"]')", { pad: 8, blur: false });
  await click("js:document.querySelector('[aria-label=\"Cerrar\"]')", { wait: 1000 });

  // ── 4. The code on a product. ──────────────────────────────────────────────
  const { data: fila, error } = await admin.from("product_barcodes").insert({ owner_id: M.ownerId, product_id: M.productos.arroz, code: CONOCIDO }).select("id").single();
  if (error) throw new Error(error.message);
  filaCodigo = fila.id;
  await go(`/productos/${M.productos.arroz}/editar`, 5000);
  const CAMPO = "js:document.querySelector('[id^=producto_codigo]').closest('div').parentElement.parentElement";
  await waitFor("!!document.querySelector('[id^=producto_codigo]')");
  await js("document.querySelector('[id^=producto_codigo]').scrollIntoView({block:'center',behavior:'instant'})");
  await sleep(500);
  await shot(S, 4, CAMPO, { pad: 6 });

  // ── 5. A known code: «Producto encontrado». ───────────────────────────────
  await go("/dashboard", 5000);
  await gun(CONOCIDO);
  await waitFor("document.body.innerText.includes('Producto encontrado')&&!document.body.innerText.includes('Buscando el código')");
  await sleep(1200);
  await shot(S, 5, "js:[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Vender')", { pad: 6 });

  // ── 6. An unknown code: «Código nuevo». ────────────────────────────────────
  await go("/dashboard", 5000);
  await gun(NUEVO);
  await waitFor("document.body.innerText.includes('Código nuevo')");
  await sleep(1200);
  await shot(S, 6, "js:[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Crear producto')", { pad: 6 });

  // ── 7. Inside a sale, each read adds one. ──────────────────────────────────
  await go("/ventas/nueva", 6000);
  await gun(CONOCIDO); await sleep(2500);
  await gun(CONOCIDO);
  await waitFor("document.body.innerText.includes('2/4 Carrito')||document.body.innerText.includes('Carrito')");
  await sleep(2500);
  await shot(S, 7, "js:[...document.querySelectorAll('input')].find(i=>i.getBoundingClientRect().height>0)", { pad: 8 });

  // ── «Registrar un abono», step 5: the method opens on «Pago móvil». ──────
  await go(`/clients/${M.clientes.julia}`, 5000);
  await click("Agregar abono", { wait: 5000 });
  // $2, under what Julia owes in the demo: an amount over the debt shows its red error.
  await type("js:document.querySelector('input[placeholder=\"00\"]')", "2", { wait: 1500 });
  const METODO = "js:document.getElementById([...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Método de pago').htmlFor).parentElement";
  await js(`(()=>{${METODO.slice(3)}.scrollIntoView({block:'center',behavior:'instant'}); return 1})()`);
  await sleep(400);
  await shot("registrar-un-abono", 5, METODO, { pad: 6 });
  console.log("método del abono:", await js("document.getElementById([...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Método de pago').htmlFor).textContent.trim()"));
} finally {
  if (filaCodigo) {
    const d = await admin.from("product_barcodes").delete().eq("id", filaCodigo).select("id");
    console.log("código de prueba borrado:", d.data?.length);
  }
  await admin.from("owners").update({ barcodes_enabled: antes.barcodes_enabled }).eq("id", M.ownerId);
  console.log("interruptor de la demo vuelto a", antes.barcodes_enabled);
}
