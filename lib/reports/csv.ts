// ═══════════════════════════════════════════════════════════════════════
// CSV QUE EXCEL ABRE BIEN EN UN WINDOWS EN ESPAÑOL
//
// Escrito a mano y no con una librería: `REPORTES-PLAN.md` fija que esta fase
// no añade dependencias, y lo único difícil de un CSV no es poner comas.
//
// ───────────────────────────────────────────────────────────────────────
// LAS CUATRO DECISIONES QUE LO HACEN LEGIBLE, Y SU COSTE
//
// 1. **BOM al principio.** Sin los tres bytes `EF BB BF`, Excel en Windows
//    abre el fichero en la página de códigos del sistema y «Peña» sale
//    «PeÃ±a». Es la única condición que `REPORTES-PLAN.md` marca como dura.
// 2. **Separador `;` y decimales con COMA.** En un Windows configurado en
//    es-VE o es-CO --que es este público-- el separador de listas ES `;` y la
//    coma decimal ES `,`. Un fichero con comas y puntos decimales cae ENTERO
//    en la columna A y además lee mal los números. Se declara con `sep=;` en
//    la primera línea para que Excel no tenga que adivinarlo.
//    **LO QUE CUESTA**: Google Sheets enseña ese `sep=;` como una celda
//    sobrante en A1. Es un precio conocido y es el barato de los dos.
// 3. **Fin de línea `\r\n`.** Lo que Excel espera; un `\n` suelto le deja
//    filas pegadas en algunas versiones.
// 4. **Guarda contra fórmulas.** Un campo que empieza por `=`, `+`, `-`, `@`,
//    tabulador o retorno lleva un `'` delante. `descripcion` y `cliente` los
//    teclea el tendero y acaban en Excel: sin esto, `=1+1` es una fórmula y
//    `=HYPERLINK(...)` es algo peor. No es paranoia de seguridad abstracta --
//    el fichero se abre en la máquina de otra persona.
// ═══════════════════════════════════════════════════════════════════════

const BOM = "﻿";
const EOL = "\r\n";
const SEP = ";";

/** Caracteres con los que Excel empieza a interpretar una celda como fórmula. */
const ARRANQUE_PELIGROSO = /^[=+\-@\t\r]/;

function campo(valor: string | number | null | undefined): string {
  if (valor == null) return "";
  let s = typeof valor === "number" ? String(valor) : valor;
  if (ARRANQUE_PELIGROSO.test(s)) s = `'${s}`;
  // Se entrecomilla solo cuando hace falta: un fichero entrecomillado de
  // arriba abajo es ilegible abierto en un editor de texto, que es cómo se
  // mira cuando Excel se porta raro.
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Una fila, ya escapada. */
export function fila(celdas: Array<string | number | null | undefined>): string {
  return celdas.map(campo).join(SEP);
}

/**
 * Un importe para la columna de dinero: dos decimales y COMA, sin separador
 * de miles.
 *
 * SIN SEPARADOR DE MILES A PROPÓSITO. `1.234,50` es lo correcto en español y
 * es exactamente lo que Excel NO reconoce como número cuando el punto es
 * también su separador decimal en otra configuración: la celda queda como
 * texto y la suma de la columna da cero. `1234,50` lo lee bien en es-VE y en
 * es-CO, que es donde se va a abrir.
 */
export function importe(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** Pega las líneas con el BOM delante y los finales de línea de Excel. */
export function documento(lineas: string[]): string {
  return BOM + `sep=${SEP}` + EOL + lineas.join(EOL) + EOL;
}
