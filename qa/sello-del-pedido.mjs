// ¿SIGUE SIENDO REVERSIBLE EL SELLO DE UN PEDIDO?
//
// No toca la base y no necesita servidor: lee el código. Un segundo.
//
// ===========================================================================
// POR QUÉ UNA SUITE DE FUENTE, HABIENDO YA UNA DE VERDAD
//
// `qa:pedido-registro` 18a-18f mide lo que importa: registrar, borrar la venta
// y comprobar que el pedido vuelve a estar pendiente. Lo que NO puede medir es
// la otra mitad --restaurar--, porque `restoreMovement` se pulsa desde la hoja
// de una notificación y eso es navegador, no HTTP.
//
// Y LA MITAD QUE NO SE MIDE ES LA PELIGROSA. `eliminarVenta` dessella el
// pedido; si `restoreMovement` dejara de volver a sellarlo, restaurar
// devolvería la venta a la vida con el pedido diciendo «pendiente» -- y el
// flujo lo dejaría registrar OTRA VEZ. Nada fallaría: el tendero recorrería
// tres pantallas y se encontraría un error al final, o peor, si algún día la
// parada dura por moneda se afloja, le cobraría dos veces al cliente.
//
// Así que esto vigila que las dos llamadas sigan ahí. No prueba que funcionen
// --para eso está la suite de verdad y la pasada por el navegador del
// 2026-10-26-- sino que nadie se lleve una por delante al refactorizar.
//
// SIN LISTA DE EXCEPCIONES, igual que `qa:lineas-borradas`, `qa:suscripciones`
// y `qa:aviso-mala-paga`: una lista hay que mantenerla, y una desactualizada
// falla en silencio.

import { readFileSync } from "node:fs";

const fallos = [];

function leer(ruta) {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    fallos.push(`${ruta} — no existe. ¿Se renombró?`);
    return "";
  }
}

// ── 1. LA FUNCIÓN, EN UN SOLO SITIO ───────────────────────────────────
const lib = leer("lib/orders/monedas-pendientes.ts");
if (lib && !/export async function recalcularSelloDelPedido/.test(lib)) {
  fallos.push(
    "lib/orders/monedas-pendientes.ts — ya no exporta `recalcularSelloDelPedido`.",
  );
}
// SELLAR TIENE QUE ESCRIBIR LAS TRES COLUMNAS. `registered_at` se olvidó en la
// primera versión, el 2026-10-26, y se vio al restaurar: el pedido volvía a
// `registered` con la fecha en nulo, y los guardias del flujo miran la FECHA,
// no el estado. La pantalla volvía a ofrecer «Registrar pedido» sobre un
// pedido ya cobrado.
if (lib && !/registered_at:\s*ultimaVenta/.test(lib)) {
  fallos.push(
    "lib/orders/monedas-pendientes.ts — al sellar ya no se repone `registered_at`, y los guardias del flujo miran esa columna, no `status`.",
  );
}

// ── 2. LAS DOS PUERTAS QUE LA LLAMAN ──────────────────────────────────
//
// Borrar y restaurar. Si una sola de las dos se queda sin llamarla, el pedido
// y su venta dejan de decir lo mismo -- y en el caso de restaurar, de la forma
// peligrosa.
const PUERTAS = [
  ["app/(app)/ventas/actions.ts", "eliminarVenta", "borrar la venta dejaría el pedido sellado para siempre (`PR-F7`)"],
  [
    "app/(app)/dashboard/actions.ts",
    "restoreMovement",
    "restaurar devolvería la venta con el pedido diciendo «pendiente», y el flujo lo dejaría registrar otra vez",
  ],
];
for (const [ruta, funcion, consecuencia] of PUERTAS) {
  const texto = leer(ruta);
  if (!texto) continue;
  if (!/recalcularSelloDelPedido\s*\(/.test(texto)) {
    fallos.push(`${ruta} — \`${funcion}\` ya no recalcula el sello: ${consecuencia}.`);
  }
}

if (fallos.length > 0) {
  console.log(`\nFALLA — el sello de un pedido dejó de ser reversible:\n`);
  for (const f of fallos) console.log(`  ✗ ${f}`);
  console.log(
    "\nUn pedido y su venta tienen que decir lo mismo. Si no, el tendero ve un",
  );
  console.log(
    "pedido «Registrado» cuya venta no existe, o uno «pendiente» que ya se",
  );
  console.log("cobró. Las dos se descubren tarde y ninguna avisa.\n");
  process.exit(1);
}

console.log(
  "PASS  el sello del pedido se recalcula al borrar la venta y al restaurarla, con su fecha.",
);
