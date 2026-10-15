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
  stock: null,
  retail: { price: 2.5, pinned: {} },
  wholesale: null,
  wholesale_min_quantity: null,
};

const CATALOGO = new Map([
  [ARROZ.id, ARROZ],
  [CAFE.id, CAFE],
]);

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
const antes = precioUnitario(ARROZ, c2[0]);
c2 = agregarLinea(c2, linea("arroz", 3));
const despues = precioUnitario(ARROZ, c2[0]);
check(
  "2. añadir 3 y 3 cruza al precio de MAYOR, no se queda en el de detal",
  antes.amount === 5 && antes.tier === "retail" && despues.amount === 4 && despues.tier === "wholesale",
  `3 uds → ${antes.amount} (${antes.tier}) · 6 uds → ${despues.amount} (${despues.tier})`,
);

// ── 3. LA MONEDA ─────────────────────────────────────────────────────────
check(
  "3a. una moneda fijada en el escalón que aplica da su importe exacto",
  precioUnitario(ARROZ, linea("arroz", 6, "EUR")).amount === 3.6,
  String(precioUnitario(ARROZ, linea("arroz", 6, "EUR"))?.amount),
);
check(
  "3b. esa misma moneda con 3 unidades NO vale: el detal no la tiene",
  precioUnitario(ARROZ, linea("arroz", 3, "EUR")) === null,
  "devuelve null para que la pantalla caiga a la moneda base",
);
check(
  "3c. la moneda base siempre vale, en los dos escalones",
  precioUnitario(ARROZ, linea("arroz", 1, "USD")).amount === 5 &&
    precioUnitario(ARROZ, linea("arroz", 9, "USD")).amount === 4,
);

// ── 4. SUBTOTALES POR MONEDA ─────────────────────────────────────────────
const mezclado = [linea("arroz", 6, "EUR"), linea("cafe", 2, "USD")];
check(
  "4a. con monedas mezcladas hay DOS subtotales, no un total inventado",
  igual(subtotales(mezclado, CATALOGO), [
    { currency: "EUR", amount: 21.6 },
    { currency: "USD", amount: 5 },
  ]),
  JSON.stringify(subtotales(mezclado, CATALOGO)),
);
check(
  "4b. dos líneas en la misma moneda se suman en UN subtotal",
  igual(subtotales([linea("arroz", 2), linea("cafe", 2)], CATALOGO), [
    { currency: "USD", amount: 15 },
  ]),
  JSON.stringify(subtotales([linea("arroz", 2), linea("cafe", 2)], CATALOGO)),
);
check(
  "4c. un producto que ya no está en el catálogo no rompe el subtotal",
  igual(subtotales([linea("arroz", 2), linea("borrado", 5)], CATALOGO), [
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

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
