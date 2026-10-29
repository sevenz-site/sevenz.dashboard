import { HandCoins, NotebookPen } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════
// LOS DOS ICONOS DEL DINERO: UN ABONO Y UN FIADO
//
// Decisión del dueño el 2026-10-29, al ver las tarjetas nuevas de Reportes:
// *«será el ícono que usaremos para todas las partes del app que se usen para
// representar abonos (…) actualízalo en toda la app»*, y lo mismo para los
// fiados.
//
// ───────────────────────────────────────────────────────────────────────
// VIVEN AQUÍ Y NO EN CADA PANTALLA, Y ESA ES LA MITAD DEL ENCARGO
//
// «El icono que usaremos en toda la app» no se cumple poniendo el mismo
// `import` en siete archivos: se cumple cuando hay UN sitio del que todos lo
// sacan. Lo contrario es exactamente lo que acaba de pasar con el anterior --
// el porcentaje y las dos flechas estaban escritos a mano en cinco pantallas,
// así que cambiarlos ha sido un barrido en vez de una línea.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ DESPLAZAN, Y LA RAZÓN VIEJA SE QUEDA ESCRITA
//
// Sustituyen a dos cosas distintas:
//
//   · `Percent` (%), que marcaba el abono en la hoja de «Registrar» y el
//     «Fiado o crédito» de «Registrar pago» -- o sea el MISMO glifo para las
//     dos cosas opuestas, que es lo que este cambio arregla de paso.
//
//   · El par `ArrowUpRight` / `ArrowDownLeft`, que `register-sheet.tsx` dejó
//     escrito el 2026-10-18 con esta razón, que sigue siendo cierta:
//     *«un tendero que ya aprendió qué flecha es un abono no tiene que volver
//     a aprenderlo aquí»*. Es lo que se cede. Lo que se gana es que el dibujo
//     diga QUÉ es --una mano con monedas, una libreta-- en vez de en qué
//     dirección va, que es una convención que hay que aprender.
//
// ───────────────────────────────────────────────────────────────────────
// EL ICONO ES LA FORMA. EL COLOR LO SIGUE PONIENDO CADA PANTALLA
//
// Aquí NO hay color, a propósito. Cada sitio donde se usan ya tomó esa
// decisión y varias están medidas:
//
//   · La hoja de «Registrar» los pinta en negro --lo pidió él ese día-- y sus
//     tres filas van sin color porque son tres destinos, no dos caras de una
//     misma pregunta.
//   · El detalle de una transacción pinta el abono en `emerald-700`, y ese
//     700 no es estético: el `emerald-600` de antes medía 3,65:1 contra
//     blanco, por debajo del piso de 4,5:1 de `DESIGN-SYSTEM.md`.
//   · Donde el abono y el fiado salen juntos como dos opciones --el diálogo de
//     movimientos, el aviso de borrado, «¿Cuánto paga?»-- van en verde y rojo,
//     que es lo que distingue las dos opciones de la misma pregunta.
//
// Meter el color aquí borraría esas tres decisiones de un plumazo.
// ═══════════════════════════════════════════════════════════════════════

/** Un abono: dinero que el cliente devuelve. */
export const IconoDeAbono = HandCoins;

/** Un fiado o crédito: lo que el cliente se lleva y queda debiendo. */
export const IconoDeFiado = NotebookPen;
