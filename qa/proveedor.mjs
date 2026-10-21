// NO HABLA CON NINGUNA BASE DE DATOS. Es lógica pura y corre en cualquier
// entorno, igual que `qa:service-role` y `qa:migrations`.
//
// EL AUTOCOMPLETADO DE PROVEEDOR, que el dueño pidió el 2026-10-14 con un
// propósito único: que el segundo producto del mismo proveedor NO cree una
// variante nueva del nombre.
//
// POR QUÉ MERECE UNA SUITE SIENDO UN CAMPO DE TEXTO. Porque la forma de
// romperlo no se ve. Si la búsqueda dejara de ignorar la caja, el campo
// seguiría pareciendo correcto en la pantalla —acepta texto, guarda, sugiere
// algo— y lo único que pasaría es que «makro» no ofrecería «Makro». El tendero
// escribiría el nombre entero, se guardaría una variante, y la lista crecería
// con duplicados hasta que alguien mirase la tabla meses después. Eso es
// exactamente la clase de fallo que una prueba barata evita y una revisión
// visual no.

import { proveedoresUnicos, sugerenciasDeProveedor } from "../lib/products/supplier.ts";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Deduplicar ────────────────────────────────────────────────────────
check(
  "1a. la misma palabra con distinta caja es UN proveedor",
  igual(proveedoresUnicos(["Makro", "MAKRO", "makro"]), ["Makro"]),
  JSON.stringify(proveedoresUnicos(["Makro", "MAKRO", "makro"])),
);

check(
  "1b. y se devuelve como el tendero lo escribió, no normalizado",
  proveedoresUnicos(["MAKRO"])[0] === "MAKRO",
  "si saliera en minúsculas le estaríamos corrigiendo un dato suyo",
);

check(
  "1c. los espacios de los bordes no crean un proveedor nuevo",
  igual(proveedoresUnicos(["  Makro  ", "Makro"]), ["Makro"]),
);

check(
  "1d. vacíos y nulos no entran",
  igual(proveedoresUnicos(["", "   ", null, "Makro"]), ["Makro"]),
);

check(
  "1e. salen en orden alfabético, para que la lista no baile entre aperturas",
  igual(proveedoresUnicos(["Zulia", "Abasto", "makro"]), ["Abasto", "makro", "Zulia"]),
  JSON.stringify(proveedoresUnicos(["Zulia", "Abasto", "makro"])),
);

// ── 2. Buscar ────────────────────────────────────────────────────────────
//
// 2a es LA prueba de este archivo. Es el caso para el que se pidió la función.
check(
  "2a. teclear en minúsculas encuentra lo escrito en mayúsculas",
  igual(sugerenciasDeProveedor(["Makro La Trinidad"], "makro"), ["Makro La Trinidad"]),
  "sin esto el autocompletado falla justo cuando sirve, y crea la variante que venía a evitar",
);

check(
  "2b. y al revés también",
  igual(sugerenciasDeProveedor(["makro la trinidad"], "MAKRO"), ["makro la trinidad"]),
);

check(
  "2c. busca por cualquier parte del nombre, no solo por el principio",
  igual(sugerenciasDeProveedor(["Makro La Trinidad"], "trinidad"), ["Makro La Trinidad"]),
  "un tendero que piensa en el sitio y no en la cadena teclea «trinidad»",
);

check(
  "2d. con el campo vacío NO ofrece nada",
  igual(sugerenciasDeProveedor(["Abasto", "Makro"], ""), []),
  "decisión del dueño el 2026-10-20: «los proveedores deben verse solo al escribir»",
);

// Esta prueba decía lo CONTRARIO hasta el 2026-10-20 y pasaba: con el campo
// vacío se ofrecían todos, pensando en el tendero que compra siempre en los
// mismos dos sitios. El dueño lo cambió porque la lista salía sola al tocar el
// campo y, en un teléfono, empujaba hacia abajo todo lo que venía después
// antes de que nadie pidiera nada. Queda escrito para que la próxima vez que
// alguien lea esta línea sepa que es una decisión y no un descuido.

check(
  "2d-bis. un espacio tampoco abre la lista",
  igual(sugerenciasDeProveedor(["Abasto", "Makro"], "   "), []),
  "se compara con el texto ya recortado, no con lo tecleado en crudo",
);

// ── 2i-2k. SIN TILDES, que es el fallo que el dueño reportó el 2026-10-20 ──
//
// «hay un proveedor de nombre "Éxito", pero al escribir "Ex" no me aparece».
// Es el peor fallo posible aquí: este campo existe para que el segundo
// producto del mismo proveedor no cree una variante nueva del nombre, y quien
// escribe sin tilde no veía el acentuado, lo daba por nuevo, y acababa con dos
// proveedores que son el mismo.

check(
  "2i. «Ex» encuentra «Éxito»",
  igual(sugerenciasDeProveedor(["Éxito", "Makro"], "Ex"), ["Éxito"]),
  "el caso exacto que reportó el dueño",
);

check(
  "2j. y al revés: «Éx» encuentra uno escrito sin tilde",
  igual(sugerenciasDeProveedor(["Exito"], "Éx"), ["Exito"]),
  "la comparación normaliza los dos lados, no solo lo tecleado",
);

check(
  "2k. escrito entero sin tilde tampoco se vuelve a sugerir",
  igual(sugerenciasDeProveedor(["Éxito"], "exito"), []),
  "si no, el acentuado saldría como sugerencia de sí mismo",
);

check(
  "2l. la ñ NO se normaliza, y eso es correcto",
  igual(sugerenciasDeProveedor(["Peñalver"], "Penalver"), []),
  "una ñ no es una n con marca: es su propia letra, y no son el mismo nombre",
);

check(
  "2e. lo ya escrito ENTERO no se vuelve a sugerir",
  igual(sugerenciasDeProveedor(["Makro"], "Makro"), []),
  "una fila que no hace nada, y en un teléfono tapa el botón de guardar",
);

check(
  "2f. ni aunque se haya escrito con otra caja",
  igual(sugerenciasDeProveedor(["Makro"], "MAKRO"), []),
);

check(
  "2g. lo que no coincide no sugiere nada",
  igual(sugerenciasDeProveedor(["Makro"], "zzz"), []),
);

check(
  "2h. nunca más de seis, para no tapar la pantalla",
  sugerenciasDeProveedor(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"], "a").length === 6,
);

// ── 3. Lo que llega de verdad desde la pantalla ──────────────────────────
//
// `/productos` manda una fila por producto, así que lo normal es que vengan
// repetidos. Si esto se rompiera, la lista enseñaría «Makro» cuatro veces.
check(
  "3. una lista con un proveedor por producto no produce duplicados",
  // CON UNA LETRA TECLEADA, no con el campo vacío: desde el 2026-10-20 el
  // campo vacío no sugiere nada, así que la prueba de los duplicados tenía
  // que pedir algo para poder verlos.
  igual(sugerenciasDeProveedor(["Makro", "Makro", "Makro", "Abasto"], "a"), ["Abasto", "Makro"]),
  JSON.stringify(sugerenciasDeProveedor(["Makro", "Makro", "Makro", "Abasto"], "a")),
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
