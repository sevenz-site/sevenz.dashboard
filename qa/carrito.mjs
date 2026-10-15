// NO HABLA CON NINGUNA BASE DE DATOS. Lógica pura, corre en cualquier entorno.
//
// EL CARRITO DEL CLIENTE FINAL: `lib/cart/cart.ts`. Entregable C.
//
// POR QUÉ ESTO MERECE UNA SUITE, y es la misma razón que `qa:precio-publico`:
// es otra de las piezas que pueden equivocarse **sin que nadie se entere**. Un
// subtotal mal sumado no da error en ninguna parte — el cliente lo ve, le
// parece raro o no, y cierra la página. El tendero solo nota que no le
// compran.
//
// Y HAY UN CASO QUE SOLO EXISTE EN EL CARRITO, que ninguna otra suite cubre:
// **fusionar dos veces el mismo producto puede cambiar el precio de la línea**,
// porque el escalón depende de la cantidad TOTAL. Añadir 3 y luego 3 más no
// son dos líneas de detal: son seis unidades al precio de mayor.

import {
  agregarLinea,
  cambiarCantidad,
  quitarLinea,
  cuantosArticulos,
  precioUnitario,
  subtotales,
  resumenPorMoneda,
} from "../lib/cart/cart.ts";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// El caso del dueño, otra vez: detal 5 USD, mayor 4 USD con EUR y USDT
// fijados, desde 6 unidades.
const ARROZ = {
  id: "arroz",
  name: "Arroz",
  photo_path: null,
  base_currency: "USD",
  currencies: ["USD", "EUR", "USDT"],
  stock: 40,
  retail: { price: 5, pinned: {} },
  wholesale: { price: 4, pinned: { EUR: 3.6, USDT: 4 } },
  wholesale_min_quantity: 6,
};

const CAFE = {
  id: "cafe",
  name: "Café",
  photo_path: null,
  base_currency: "USD",
  currencies: ["USD"],
  stock: null,
  retail: { price: 2.5, pinned: {} },
  wholesale: null,
  wholesale_min_quantity: null,
};

const CATALOGO = new Map([
  [ARROZ.id, ARROZ],
  [CAFE.id, CAFE],
]);

// LAS PRUEBAS 1 A 8 PASAN `null` COMO TASA, Y ESO NO ES PEREZA.
//
// Sin tasa solo se resuelven el precio base y los fijados a mano, que es
// exactamente lo que esas pruebas afirmaban cuando se escribieron el
// 2026-10-14. Dejarlas así conserva su significado intacto Y fija de paso la
// regla que más caro habría salido perder: **sin tasa no se inventa una**.
//
// Hasta el 2026-10-15 la pantalla pasaba `rates ?? { usd: 1, eur: 1, usdt:
// null }`, inofensivo mientras ninguna moneda calculada se ofrecía. En cuanto
// la conversión pasó a ser el camino normal, esa reserva habría cotizado el
// euro a la par del dólar a cualquier negocio venezolano al que le faltara la
// tasa del BCV. La prueba 9c es la que no deja que vuelva.
//
// El comportamiento nuevo —convertir cuando SÍ hay tasa— va en la sección 9.
const SIN_TASA = null;
const TASA = { usd: 100, eur: 120, usdt: null };

const linea = (productId, quantity, currency = "USD", comment = null) => ({
  productId,
  quantity,
  currency,
  comment,
});

// ── 1. FUSIONAR: se suman las cantidades ─────────────────────────────────
let carrito = agregarLinea([], linea("arroz", 2));
carrito = agregarLinea(carrito, linea("arroz", 3));
check(
  "1a. el mismo producto dos veces se SUMA, no se duplica",
  carrito.length === 1 && carrito[0].quantity === 5,
  `${carrito.length} línea(s), cantidad ${carrito[0]?.quantity}`,
);

carrito = agregarLinea(carrito, linea("cafe", 1));
check("1b. un producto distinto sí añade línea", carrito.length === 2);

// ── 2. EL CASO QUE SOLO EXISTE AL FUSIONAR ───────────────────────────────
//
// Tres y tres son seis, y seis ya es precio de mayor. Si una línea guardara
// el precio del momento de añadir, esta se habría quedado en 5 por unidad.
let c2 = agregarLinea([], linea("arroz", 3));
const antes = precioUnitario(ARROZ, c2[0], SIN_TASA);
c2 = agregarLinea(c2, linea("arroz", 3));
const despues = precioUnitario(ARROZ, c2[0], SIN_TASA);
check(
  "2. añadir 3 y 3 cruza al precio de MAYOR, no se queda en el de detal",
  antes.amount === 5 && antes.tier === "retail" && despues.amount === 4 && despues.tier === "wholesale",
  `3 uds → ${antes.amount} (${antes.tier}) · 6 uds → ${despues.amount} (${despues.tier})`,
);

// ── 3. LA MONEDA ─────────────────────────────────────────────────────────
check(
  "3a. una moneda fijada en el escalón que aplica da su importe exacto",
  precioUnitario(ARROZ, linea("arroz", 6, "EUR"), SIN_TASA).amount === 3.6,
  String(precioUnitario(ARROZ, linea("arroz", 6, "EUR"), SIN_TASA)?.amount),
);
check(
  "3b. esa misma moneda con 3 unidades NO vale: el detal no la tiene",
  precioUnitario(ARROZ, linea("arroz", 3, "EUR"), SIN_TASA) === null,
  "devuelve null para que la pantalla caiga a la moneda base",
);
check(
  "3c. la moneda base siempre vale, en los dos escalones",
  precioUnitario(ARROZ, linea("arroz", 1, "USD"), SIN_TASA).amount === 5 &&
    precioUnitario(ARROZ, linea("arroz", 9, "USD"), SIN_TASA).amount === 4,
);

// ── 4. SUBTOTALES POR MONEDA ─────────────────────────────────────────────
const mezclado = [linea("arroz", 6, "EUR"), linea("cafe", 2, "USD")];
check(
  "4a. con monedas mezcladas hay DOS subtotales, no un total inventado",
  igual(subtotales(mezclado, CATALOGO, SIN_TASA), [
    { currency: "EUR", amount: 21.6 },
    { currency: "USD", amount: 5 },
  ]),
  JSON.stringify(subtotales(mezclado, CATALOGO, SIN_TASA)),
);
check(
  "4b. dos líneas en la misma moneda se suman en UN subtotal",
  igual(subtotales([linea("arroz", 2), linea("cafe", 2)], CATALOGO, SIN_TASA), [
    { currency: "USD", amount: 15 },
  ]),
  JSON.stringify(subtotales([linea("arroz", 2), linea("cafe", 2)], CATALOGO, SIN_TASA)),
);
check(
  "4c. un producto que ya no está en el catálogo no rompe el subtotal",
  igual(subtotales([linea("arroz", 2), linea("borrado", 5)], CATALOGO, SIN_TASA), [
    { currency: "USD", amount: 10 },
  ]),
  "se ignora la línea huérfana en vez de reventar",
);

// ── 5. CANTIDADES Y BORRADO ──────────────────────────────────────────────
const c5 = [linea("arroz", 4), linea("cafe", 1)];
check(
  "5a. bajar a cero QUITA la línea, no deja una de cero",
  cambiarCantidad(c5, "arroz", 0).length === 1,
  "una línea de cero sería un estado que el servidor rechaza",
);
check("5b. quitar una línea deja la otra", quitarLinea(c5, "arroz").length === 1);
check("5c. el contador suma las cantidades, no las líneas", cuantosArticulos(c5) === 5, "4 + 1");

// ── 6. EL COMENTARIO NO SE PIERDE ────────────────────────────────────────
let c6 = agregarLinea([], linea("arroz", 1, "USD", "sin bolsa"));
c6 = agregarLinea(c6, linea("arroz", 1, "USD", "que esté fresco"));
check(
  "6a. dos comentarios distintos se juntan, no se pisan",
  c6[0].comment === "sin bolsa · que esté fresco",
  c6[0].comment,
);
let c6b = agregarLinea([], linea("arroz", 1, "USD", "sin bolsa"));
c6b = agregarLinea(c6b, linea("arroz", 1, "USD", null));
check(
  "6b. añadir sin comentario NO borra el que ya había",
  c6b[0].comment === "sin bolsa",
  c6b[0].comment,
);
let c6c = agregarLinea([], linea("arroz", 1, "USD", "igual"));
c6c = agregarLinea(c6c, linea("arroz", 1, "USD", "igual"));
check("6c. el mismo comentario dos veces no se duplica", c6c[0].comment === "igual", c6c[0].comment);

const largo = "x".repeat(400);
let c6d = agregarLinea([], linea("arroz", 1, "USD", largo));
c6d = agregarLinea(c6d, linea("arroz", 1, "USD", largo.replace(/x/g, "y")));
check(
  "6d. juntándolos no se pasa de 500, que es el tope de la columna",
  c6d[0].comment.length === 500,
  `${c6d[0].comment.length} caracteres`,
);

// ── 7. LA MONEDA NUEVA GANA ──────────────────────────────────────────────
let c7 = agregarLinea([], linea("arroz", 3, "USD"));
c7 = agregarLinea(c7, linea("arroz", 3, "EUR"));
check(
  "7. al volver a añadir, manda la moneda recién elegida",
  c7[0].currency === "EUR",
  "es la que el cliente acaba de ver en pantalla",
);

// ── 8. EL RESUMEN AGRUPADO, que se pinta con el carrito ya vacío ─────────
const resumen = resumenPorMoneda(
  [linea("arroz", 6, "EUR"), linea("cafe", 2, "USD"), linea("arroz2", 1, "USD")],
  new Map([...CATALOGO, ["arroz2", { ...ARROZ, id: "arroz2", name: "Arroz grande" }]]),
  SIN_TASA,
);
check(
  "8a. agrupa por moneda y conserva las líneas",
  resumen.length === 2 &&
    resumen[0].currency === "EUR" &&
    resumen[0].items.length === 1 &&
    resumen[1].currency === "USD" &&
    resumen[1].items.length === 2,
  JSON.stringify(resumen.map((r) => `${r.currency}:${r.items.length}`)),
);
check(
  "8b. cada línea lleva su precio unitario Y su total",
  resumen[0].items[0].unitPrice === 3.6 && resumen[0].items[0].total === 21.6,
  JSON.stringify(resumen[0].items[0]),
);
check(
  "8c. el total de cada moneda es la suma de SUS líneas",
  resumen[0].total === 21.6 && resumen[1].total === 10,
  `EUR ${resumen[0].total} · USD ${resumen[1].total}`,
);
check(
  "8d. un producto que ya no está no aparece ni descuadra el total",
  resumenPorMoneda([linea("arroz", 2), linea("fantasma", 9)], CATALOGO, SIN_TASA)[0].total === 10,
  "la línea huérfana se ignora",
);

// ── 9. LA MONEDA CALCULADA, que hasta el 2026-10-15 hacía DESAPARECER la
//       línea del carrito ───────────────────────────────────────────────
//
// El fallo que estas pruebas vigilan es el peor de los cuatro que tenía esta
// suposición, porque es el único silencioso: `precioUnitario` solo resolvía la
// base y los precios fijados, así que una línea en una moneda derivada de la
// tasa —el caso NORMAL, no la excepción— devolvía null y el producto no se
// pintaba. Ni error, ni aviso, ni hueco: el cliente añadía algo y su carrito
// simplemente no lo tenía.
//
// El Casco de dev es el caso real: USD base, EUR y USDT activos, cero precios
// fijados.
const CASCO = {
  id: "casco",
  name: "Casco",
  photo_path: null,
  base_currency: "USD",
  currencies: ["USD", "EUR", "USDT"],
  stock: 3,
  retail: { price: 45.5, pinned: {} },
  wholesale: { price: 40.25, pinned: {} },
  wholesale_min_quantity: 6,
};
const CON_CASCO = new Map([[CASCO.id, CASCO]]);

check(
  "9a. una línea en euros SÍ tiene precio, convertido con la tasa",
  precioUnitario(CASCO, linea("casco", 1, "EUR"), TASA)?.amount === 37.92,
  `45,50 USD a 100/120 = ${precioUnitario(CASCO, linea("casco", 1, "EUR"), TASA)?.amount}`,
);
check(
  "9b. y antes del arreglo era null, que es lo que la borraba del carrito",
  precioUnitario(CASCO, linea("casco", 1, "EUR"), SIN_TASA) === null,
  "sin tasa no hay número, y sin número no se ofrece",
);
check(
  "9c. SIN TASA NO SE INVENTA UNA: el euro no vale lo mismo que el dólar",
  precioUnitario(CASCO, linea("casco", 1, "EUR"), SIN_TASA)?.amount !== 45.5,
  "la reserva 1:1 que la pantalla tenía habría devuelto 45,5 aquí",
);
check(
  "9d. el USDT no se puede pedir aunque esté activo: no hay tasa de USDT",
  precioUnitario(CASCO, linea("casco", 1, "USDT"), TASA) === null,
  "CriptoYa no se llama desde una página pública (2026-10-10)",
);
check(
  "9e. una moneda que el tendero RETIRÓ deja de tener precio",
  precioUnitario(
    { ...CASCO, currencies: ["USD"] },
    linea("casco", 1, "EUR"),
    TASA,
  ) === null,
  "la línea puede llevar días en localStorage; el servidor la rechazaría",
);
check(
  "9f. la base se resuelve aunque no esté en la lista de activas",
  precioUnitario({ ...CASCO, currencies: [] }, linea("casco", 1, "USD"), TASA)?.amount === 45.5,
  "una ficha descuadrada no deja un producto sin su propia moneda",
);
check(
  "9g. el escalón sigue mandando sobre el importe convertido",
  precioUnitario(CASCO, linea("casco", 6, "EUR"), TASA)?.amount === 33.54,
  `40,25 al mayor, no 45,50: ${precioUnitario(CASCO, linea("casco", 6, "EUR"), TASA)?.amount}`,
);
check(
  "9h. un precio FIJADO gana sobre la conversión, también aquí",
  precioUnitario(
    { ...CASCO, retail: { price: 45.5, pinned: { EUR: 39 } } },
    linea("casco", 1, "EUR"),
    TASA,
  )?.amount === 39,
  "un candado cerrado es una decisión del tendero; la tasa es el valor de partida",
);
check(
  "9i. los subtotales mezclan convertido y base sin inventar un total único",
  igual(subtotales([linea("casco", 1, "EUR"), linea("casco", 1, "USD")], CON_CASCO, TASA), [
    { currency: "EUR", amount: 37.92 },
    { currency: "USD", amount: 45.5 },
  ]),
  JSON.stringify(subtotales([linea("casco", 1, "EUR"), linea("casco", 1, "USD")], CON_CASCO, TASA)),
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
