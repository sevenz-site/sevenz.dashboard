// One clean screen per help topic (no ring), for the topic's cover in the
// /ayuda index. `componer-portadas.py` puts each one inside a phone.
// The bin cover moves Carmen Linares (demo, no debt) to the bin and RESTORES
// her, leaving the demo business as it was.
import { go, click, type, js, sleep, call, openMenu, pick, clearPopups, DIALOG } from "../lib.mjs";
import { M } from "./_m.mjs";
import { fileURLToPath } from "node:url";
const RAW = fileURLToPath(new URL("../raw-portadas", import.meta.url)).split(String.fromCharCode(92)).join("/");
const top = (expr, margin = 70) => js(`(()=>{const e=${expr}; if(!e) return false; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return true})()`);
const snap = async (slug) => {
  await js("document.activeElement?.blur?.()"); await sleep(600);
  await call({ op: "shot", file: `${RAW}/${slug}.png`, target: null, crop: 0 });
  console.log(`  ✔ ${slug}`);
};
const only = process.argv.slice(2);
const want = (s) => !only.length || only.includes(s);

if (want("registrar-un-fiado")) { await go("/ventas/nueva", 7000); await snap("registrar-un-fiado"); }
if (want("registrar-un-abono")) {
  await go(`/abonos/nuevo?cliente=${M.clientes.julia}&desde=cliente`, 6000);
  await type("js:document.querySelector('input[placeholder=\"00\"]')", "20", { wait: 1500 });
  await snap("registrar-un-abono");
}
if (want("atender-un-pedido")) { await go("/productos/ordenes", 5000); await snap("atender-un-pedido"); }
if (want("compartir-el-link-del-cliente")) { await go(`/s/${M.shareToken}`, 5000); await clearPopups(); await snap("compartir-el-link-del-cliente"); }
if (want("marcar-una-mala-paga")) { await go("/malas-pagas", 5000); await snap("marcar-una-mala-paga"); }
if (want("ver-el-puntaje-del-cliente")) {
  await go(`/clients/${M.clientes.julia}`, 5000);
  await top("[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Puntaje de crédito'))", 120);
  await snap("ver-el-puntaje-del-cliente");
}
if (want("calculadora-de-tasa")) {
  await go("/dashboard", 4000); await click("Calcular", { wait: 2000 });
  await type("js:document.querySelector('[role=dialog] input')", "2000", { wait: 1000 });
  await snap("calculadora-de-tasa");
}
if (want("ver-tus-reportes")) { await go("/reportes", 8000); await snap("ver-tus-reportes"); }
if (want("crear-un-producto")) { await go(`/productos/${M.productos.harina}`, 5000); await snap("crear-un-producto"); }
if (want("compartir-tu-catalogo")) { await go(`/c/${M.catalogToken}`, 6000); await clearPopups(); await snap("compartir-tu-catalogo"); }
if (want("importar-tu-libreta")) { await go("/import", 5000); await snap("importar-tu-libreta"); }
if (want("la-papelera")) {
  await go(`/clients/${M.clientes.carmen}`, 5000);
  await openMenu("Más opciones"); await pick("Mover a papelera", { wait: 1500 });
  await click("Mover a papelera", { scope: DIALOG, wait: 1000 });
  await sleep(4000);
  await go("/papelera", 5000);
  await snap("la-papelera");
  await click("Restaurar", { wait: 3000 });
  console.log("  papelera tras restaurar:", (await js("document.body.innerText")).includes("Tu papelera está vacía") ? "vacía ✓" : "¡CARMEN SIGUE EN LA PAPELERA!");
}
if (want("mi-negocio")) { await go("/profile", 5000); await snap("mi-negocio"); }
if (want("verificacion-en-dos-pasos")) {
  await go("/profile", 5000);
  await top("[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Seguridad de la cuenta')");
  await snap("verificacion-en-dos-pasos");
}
if (want("instalar-la-app-en-tu-telefono")) {
  // The app itself, as it opens from the home screen: the install steps
  // happen in the browser's own menus, which no app screen shows.
  await go("/dashboard", 5000);
  await snap("instalar-la-app-en-tu-telefono");
}
