// ¿SIGUE EN PIE EL AVISO DE «MALA PAGA» DEL FLUJO DE PEDIDOS?
//
// No toca la base de datos y no necesita servidor: lee el código. Un segundo.
//
// ===========================================================================
// POR QUÉ UNA SUITE DE FUENTE Y NO UNA DE NAVEGADOR
//
// El aviso es un diálogo: se ve al tocar un botón, así que una suite no lo
// puede pulsar. Lo que SÍ se puede vigilar es lo único de él que falla en
// silencio: **el dato**.
//
// El diálogo sale si `ficha.is_flagged` es verdad. Si alguien quita
// `is_flagged` del `select` de `findOrderClient` --refactorizando, acortando
// una consulta, copiándola a otro sitio-- el valor pasa a ser `undefined`, la
// condición pasa a ser falsa, y **el diálogo deja de salir sin que nada se
// rompa**. Compila, no hay error, las demás suites pasan. Exactamente la clase
// de avería que este repo ya ha pagado con un `grant` que faltaba y con un
// `subscribe` que no avisaba.
//
// ===========================================================================
// QUÉ COSTÓ NO TENERLO, Y ES LO QUE ESTA SUITE RECUERDA
//
// El diálogo existía en `components/dashboard/add-movement-dialog.tsx` y se
// fue con ese fichero el 2026-10-24, cuando el dueño mandó borrar aquel flujo
// --*«ese flujo ya no debe existir»*--. Nadie se dio cuenta de que con el
// formulario se iba el ÚNICO aviso de mala paga que la app ha tenido: desde
// ese día y hasta el 2026-10-26, ninguna pantalla de Sevenz lo mencionaba
// antes de fiar.
//
// Lo midió el documento de bordes (`PR-E6`): cuatro pantallas del flujo de
// pedido, cero menciones, y dos de ellas con la tarjeta VERDE «El cliente ya
// existe en tu cuenta de Sevenz» sobre la persona que el tendero había puesto
// en su lista negra. Eso no era silencio: era un aval.
//
// Así que lo que esta suite impide no es un bug nuevo: es que el aviso se
// vuelva a perder de la misma forma, al borrar o reescribir el sitio donde
// vive.
//
// SIN LISTA DE EXCEPCIONES, igual que `qa:lineas-borradas` y
// `qa:suscripciones`: una lista hay que mantenerla, y una desactualizada falla
// en silencio -- que es el fallo que esto cierra.

import { readFileSync } from "node:fs";

const fallos = [];

function leer(ruta) {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    fallos.push(`${ruta} — no existe. ¿Se renombró? El aviso vive aquí.`);
    return "";
  }
}

// ── 1. EL DATO: la marca se LEE de la base ────────────────────────────
const match = leer("lib/orders/order-client-match.ts");
if (match && !/\.select\([^)]*is_flagged/.test(match)) {
  fallos.push(
    "lib/orders/order-client-match.ts — el `select` de `findOrderClient` ya no pide `is_flagged`.",
  );
}
if (match && !/is_flagged:\s*boolean/.test(match)) {
  fallos.push(
    "lib/orders/order-client-match.ts — el tipo `OrderClient` ya no declara `is_flagged`.",
  );
}

// ── 2. LA CONDICIÓN: una sola, y la usan las dos puertas ──────────────
//
// `quedaFiado` es lo que distingue «le estoy fiando» de «me está pagando». El
// diálogo original solo salía al fiar (`isFlagged && type === "charge"`), y sin
// esa mitad el aviso saldría también en una venta de contado -- una alarma que
// suena siempre, que se deja de leer.
const resumen = leer("components/dashboard/order-registration-summary.tsx");
if (resumen && !/export function quedaFiado/.test(resumen)) {
  fallos.push(
    "components/dashboard/order-registration-summary.tsx — ya no exporta `quedaFiado`, que es lo que decide si el aviso sale.",
  );
}

// ── 3. LAS DOS PUERTAS ────────────────────────────────────────────────
//
// EL REGISTRO SE ESCRIBE DESDE DOS PANTALLAS y las dos tienen que preguntar:
// el paso del cliente, y el PAGO -- que es quien escribe cuando el cliente ya
// está en el borrador, o sea en la segunda pasada de un pedido de dos monedas.
// Un aviso montado solo en la primera no saldría nunca justo en ese caso.
//
// Es la regla de `CLAUDE.md`: «un campo nuevo entra por TODAS las puertas de su
// acción».
const PUERTAS = [
  "components/dashboard/order-client-step.tsx",
  "components/dashboard/order-currency-payment-form.tsx",
];
for (const ruta of PUERTAS) {
  const texto = leer(ruta);
  if (!texto) continue;
  if (!/quedaFiado\s*\(/.test(texto)) {
    fallos.push(`${ruta} — escribe la venta y ya no llama a \`quedaFiado\`.`);
  }
  if (!/is_flagged|marcada/.test(texto)) {
    fallos.push(`${ruta} — ya no mira la marca de mala paga.`);
  }
  if (!/está marcado como Mala paga/.test(texto)) {
    fallos.push(`${ruta} — falta el diálogo: el título que el dueño pidió.`);
  }
  if (!/Fiar de todas formas/.test(texto)) {
    fallos.push(`${ruta} — falta la salida «Fiar de todas formas» del diálogo.`);
  }
}

// ── 4. Y EL CHIP, QUE ES LA OTRA MITAD DEL AVISO ──────────────────────
//
// Encargo del dueño el 2026-10-26, al leer el informe del diálogo: la tarjeta
// «sigue diciendo solo "ya existe"». El diálogo avisa en el ÚLTIMO toque,
// cuando el tendero ya decidió; el chip avisa mientras lo está decidiendo.
//
// SE VIGILA `MALA_PAGA_BADGE_CLASS` Y NO EL TEXTO «Mala paga»: esos dos
// ficheros ya llevan esa frase dentro del diálogo, así que buscarla pasaría
// en verde con el chip borrado. El token es lo único que solo tiene el chip --
// y además es el que lleva el negro medido, así que una copia de sus clases se
// quedaría atrás el día que se afine.
const TARJETAS = [
  // El recuadro verde del paso del cliente.
  "components/dashboard/order-client-step.tsx",
  // El del detalle del pedido, `OrderClientMatchAlert`.
  "components/dashboard/order-client-card.tsx",
  // Y la tarjeta del `1/4`, que es la ÚNICA tarjeta de cliente de la segunda
  // pasada de un pedido de dos monedas: ahí el paso del cliente se salta, así
  // que el recuadro verde no pasa por delante de nadie.
  "components/dashboard/order-registered-client-card.tsx",
];
for (const ruta of TARJETAS) {
  const texto = leer(ruta);
  if (!texto) continue;
  if (!/MALA_PAGA_BADGE_CLASS/.test(texto)) {
    fallos.push(
      `${ruta} — perdió el chip «Mala paga»: la tarjeta presenta a esa persona sin una marca.`,
    );
  }
}

if (fallos.length > 0) {
  console.log(`\nFALLA — el aviso de «mala paga» del flujo de pedidos:\n`);
  for (const f of fallos) console.log(`  ✗ ${f}`);
  console.log(
    "\nEl tendero podría fiarle a alguien de su lista negra sin un solo aviso,",
  );
  console.log(
    "y con la tarjeta verde «el cliente ya existe» delante. Encargo del dueño",
  );
  console.log("el 2026-10-26; ya se perdió una vez al borrar el flujo viejo.\n");
  process.exit(1);
}

console.log(
  "PASS  el aviso de «mala paga» sigue en pie: la marca se lee, `quedaFiado` decide, las dos puertas preguntan y las tres tarjetas llevan su chip.",
);
