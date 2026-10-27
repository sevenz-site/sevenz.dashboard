// ¿SE ESCONDE CON EL TECLADO TODO LO QUE VA PEGADO ABAJO?
//
// No toca la base y no necesita servidor: lee el código. Un segundo.
//
// ===========================================================================
// EL FALLO QUE ESTO CIERRA, Y LLEVA TRES REPORTES
//
// `CLAUDE.md` lo tiene en mayúsculas: *«CON EL TECLADO ARRIBA NO QUEDA NADA
// PEGADO AL BORDE DE ABAJO»*. El dueño lo ha pedido el 2026-10-18, el
// 2026-10-20 y el 2026-10-21, y lo que lo hace repetible es que **cada vez
// falló por un motivo distinto**:
//
//   1. No había componente. Nació `StickyActions`.
//   2. UNA PANTALLA TENÍA SUS CLASES COPIADAS A MANO. Eran casi idénticas
//      --`gap-3` contra `gap-4`-- así que a la vista no se distinguían, pero
//      la copia no heredaba lo único que el original añade.
//   3. El componente estaba bien montado y el DETECTOR se quedó ciego.
//
// ESTA SUITE VIGILA EL (2), que es el único de los tres que se puede leer en
// el código. Y no es hipotético: el 2026-10-26, buscando otra cosa, apareció
// `components/public/product-detail.tsx` con las clases copiadas HASTA EL
// `pb-[calc(env(safe-area-inset-bottom)+2.5rem)]` carácter por carácter, su
// campo de «Comentarios» debajo, y ningún `useKeyboardOpen`. Nadie lo había
// visto en un mes.
//
// ===========================================================================
// LA REGLA, Y POR QUÉ NO LLEVA LISTA DE EXCEPCIONES
//
// **Un fichero que ancla algo al borde inferior Y tiene un campo de texto
// tiene que saber del teclado** -- montando `StickyActions` o llamando a
// `useKeyboardOpen`.
//
// La condición sale del fichero mismo, así que no hay nada que mantener: una
// barra en una pantalla SIN campos de texto no puede quedar tapada por un
// teclado que nunca sube, y no se le exige nada. El día que esa pantalla gane
// un campo, la regla empieza a aplicarse sola.
//
// Es a propósito la misma forma que `qa:lineas-borradas`, `qa:suscripciones`
// y `qa:sello-del-pedido`: una lista a mano hay que mantenerla, y una
// desactualizada falla en silencio -- que es el fallo que esto cierra.
//
// LO QUE ESTA SUITE NO PUEDE VER, dicho para que nadie la lea como una
// garantía: si el teclado TAPA DE VERDAD la barra en un teléfono. El panel
// del navegador desenfoca el campo al cambiar de tamaño, o sea que apaga
// justo la condición que habría que medir. Eso sigue necesitando un teléfono
// real, y hasta entonces la fila de QA dice «no probado», no «pasa».

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAICES = ["app", "components", "hooks", "lib"];

function ficheros(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === "node_modules" || entrada.startsWith(".")) continue;
      salida.push(...ficheros(ruta));
    } else if (/\.(tsx|ts)$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

// ANCLADO ABAJO. `sticky bottom-0` y `fixed bottom-0` son las dos formas que
// este repo usa; `inset-x-0 bottom-0` es la tercera, que es un `fixed` escrito
// en dos trozos.
const ANCLADA = /(sticky|fixed)\s+(inset-x-0\s+)?bottom-0/;
// UN CAMPO DONDE SE TECLEA. Un `<select>` abre una rueda y no un teclado, así
// que no cuenta -- es el mismo criterio que usa el propio `useKeyboardOpen`
// para decidir cuándo recalibrar.
const CAMPO = /<(Input|Textarea|input|textarea)[\s>]|contentEditable/;
const SABE_DEL_TECLADO = /StickyActions|useKeyboardOpen/;

// ── UN CAMPO DENTRO DE UN MODAL NO ESTÁ AL LADO DE LA BARRA, ESTÁ ENCIMA
//
// Lo enseñó `components/public/cart-screen.tsx` el 2026-10-26, la primera vez
// que esta suite corrió: su barra lleva «Completar orden» y sus cuatro campos
// --nombre, documento, WhatsApp, dirección-- viven dentro de un `<Dialog>` que
// TAPA el carrito entero. Nunca se ven a la vez, así que el teclado de esos
// campos no puede estar tapando esa barra. Marcarlo habría sido una alarma
// falsa, y una alarma falsa entrena a pasar de largo.
//
// SALVO QUE LA BARRA ESTÉ DENTRO DEL MISMO MODAL, que es el caso de las hojas
// con su propio pie --`import-flow`, `detalle-del-cliente`--: ahí campo y
// barra sí comparten pantalla y la regla se aplica entera.
//
// Sigue sin haber lista: lo que decide es dónde está cada cosa en el fichero.
function camposQueCompartenPantalla(codigo, anclaIdx) {
  const bloques = [];
  for (const etiqueta of ["DialogContent", "SheetContent"]) {
    const abre = new RegExp(`<${etiqueta}[\\s>]`, "g");
    const cierre = `</${etiqueta}>`;
    let m;
    while ((m = abre.exec(codigo)) !== null) {
      const fin = codigo.indexOf(cierre, m.index);
      if (fin > 0) bloques.push([m.index, fin + cierre.length]);
    }
  }
  const dentroDeOtroModal = (i) =>
    bloques.some(([a, b]) => i >= a && i < b && !(anclaIdx >= a && anclaIdx < b));

  const campo = new RegExp(CAMPO.source, "g");
  let m;
  while ((m = campo.exec(codigo)) !== null) {
    if (!dentroDeOtroModal(m.index)) return true;
  }
  return false;
}

const fallos = [];
let anclados = 0;

for (const raiz of RAICES) {
  for (const ruta of ficheros(raiz)) {
    const texto = readFileSync(ruta, "utf8");
    // Solo el código: un comentario que MENCIONA `fixed bottom-0` --los hay,
    // explicando por qué NO se usa-- no ancla nada.
    const codigo = texto
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const ancla = ANCLADA.exec(codigo);
    if (!ancla) continue;
    anclados += 1;
    if (!camposQueCompartenPantalla(codigo, ancla.index)) continue;
    if (SABE_DEL_TECLADO.test(codigo)) continue;
    fallos.push(
      `${ruta.replace(/\\/g, "/")} — ancla algo al borde de abajo y tiene un campo de texto en la misma pantalla, pero no monta \`StickyActions\` ni llama a \`useKeyboardOpen\`.`,
    );
  }
}

if (fallos.length > 0) {
  console.log(`\nFALLA — hay barras pegadas abajo que no saben del teclado:\n`);
  for (const f of fallos) console.log(`  ✗ ${f}`);
  console.log(
    "\nCon el teclado arriba esa barra se queda flotando encima y tapa el campo",
  );
  console.log(
    "que se está rellenando. El dueño lo ha reportado TRES veces, y una de las",
  );
  console.log(
    "tres fue exactamente esto: una pantalla con las clases copiadas a mano.\n",
  );
  process.exit(1);
}

console.log(
  `PASS  ${anclados} barra(s) pegada(s) al borde de abajo, y las que tienen campos saben del teclado.`,
);
