// WHAT A TEMPLATE'S BUTTON POINTS AT HAS TO KEEP EXISTING. No database, one second.
//
// Owner's rule of 2026-11-06: every change to Reportes is weighed against the templates. An
// address Meta approved cannot be edited, and a section that moves fails in silence: the tab
// opens and nothing scrolls. It also checks the door those buttons depend on: that signing in
// can only send someone back into Reportes, never out of Sevenz.
import { readFileSync } from "node:fs";
import { SECCIONES } from "../lib/reports/secciones.ts";
import { DESTINO_DE_PLANTILLA, urlDelBoton } from "../lib/whatsapp/destinos.ts";
import { safeReturnPath } from "../lib/auth/return-after-login.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

const conSeccion = Object.entries(DESTINO_DE_PLANTILLA).filter(([, d]) => d !== "inicio");
const perdidas = conSeccion.filter(([, d]) => !(d.seccion in SECCIONES)).map(([n]) => n);
check("1. cada destino es una sección que existe", perdidas.length === 0, perdidas.join(", "));

const pestanas = { facturacion: "reportes-facturacion", inventario: "reportes-inventario", proveedores: "reportes-proveedores" };
const sinAncla = conSeccion.filter(([, d]) => {
  const archivo = pestanas[SECCIONES[d.seccion].tab];
  return !readFileSync(`components/dashboard/${archivo}.tsx`, "utf8").includes(d.seccion);
}).map(([n, d]) => `${n}: ${d.seccion}`);
check("2. esa sección se dibuja en su pestaña", sinAncla.length === 0, sinAncla.join(", "));

const url = urlDelBoton("atencion_cobros");
check("3. la dirección lleva pestaña y sección, sin #", url === "https://app.sevenz.site/reportes?tab=facturacion&seccion=plazos", url);
check("4. la que habla de 7 días abre 7 días", urlDelBoton("negocio_resumen").includes("periodo=7d"), urlDelBoton("negocio_resumen"));
check("5. las de cuenta van a Inicio", urlDelBoton("cuenta_lista") === "https://app.sevenz.site");
check("6. una plantilla desconocida no inventa dirección", urlDelBoton("no_existe") === null);

check("7. una dirección de Reportes vuelve", safeReturnPath("/reportes?tab=facturacion&seccion=plazos") === "/reportes?tab=facturacion&seccion=plazos");
for (const malo of ["https://malo.example", "//malo.example", "/\\malo.example", "/reportes/../admin", "/admin", "/login", "/reportesfalso", "/reportes?x=1\nSet-Cookie: a=b", "", null]) {
  check(`8. rechaza ${JSON.stringify(malo)}`, safeReturnPath(malo) === null);
}

console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
process.exit(filas.every(Boolean) ? 0 : 1);
