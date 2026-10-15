// NO HABLA CON NINGUNA BASE DE DATOS. Lógica pura, corre en cualquier entorno.
//
// QUÉ PRECIO VE EL CLIENTE FINAL SEGÚN CUÁNTO PIDE. Decisión del dueño el
// 2026-10-14, que corrige el frame 1192:4185: se ve un escalón o el otro,
// nunca los dos.
//
// POR QUÉ ESTO MERECE UNA SUITE MÁS QUE CUALQUIER OTRA COSA DEL CATÁLOGO:
// es la única parte del detalle público que puede equivocarse **sin que nadie
// se entere**. Si se rompe, un cliente ve el precio de mayor por una unidad —o
// paga de más por doce— y lo único que hace es cerrar la página. No hay
// reporte, no hay error en ningún log, y el tendero solo nota que no le
// compran. Todo lo demás del catálogo lo reporta el tendero porque lo usa; de
// esta pantalla no se entera.

import {
  cantidadMinima,
  escalonParaCantidad,
  monedasDelProducto,
  precioEnMoneda,
} from "../lib/products/public-pricing.ts";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. EL CASO DEL DUEÑO, palabra por palabra ────────────────────────────
//
// «precio al detal de 5 dólares, al mayor euros, USDT y dólares, venta al
// mayor a partir de 6 unidades».
const elCasoDelDueno = {
  retail: { price: 5, pinned: {} },
  wholesale: { price: 4, pinned: { EUR: 3.6, USDT: 4 } },
  wholesale_min_quantity: 6,
};

check(
  "1a. pidiendo 1 se ve el DETAL",
  escalonParaCantidad(elCasoDelDueno, 1) === "retail",
);
check(
  "1b. pidiendo 5 —una menos que el mínimo— todavía el DETAL",
  escalonParaCantidad(elCasoDelDueno, 5) === "retail",
  "el borde de abajo, que es donde se equivoca un `>` por un `>=`",
);
check(
  "1c. pidiendo exactamente 6 se ve el MAYOR",
  escalonParaCantidad(elCasoDelDueno, 6) === "wholesale",
  "«a partir de 6» incluye el 6",
);
check(
  "1d. pidiendo 20 se ve el MAYOR",
  escalonParaCantidad(elCasoDelDueno, 20) === "wholesale",
);
// LAS MONEDAS SON DEL PRODUCTO, NO DEL ESCALÓN, desde el 2026-10-15.
//
// Esto corrige dos cosas a la vez, y conviene separarlas porque una era un
// fallo y la otra una decisión tomada sobre información mala:
//
// 1. EL FALLO. `monedasDelEscalon` leía `bloque.pinned`, o sea los precios
//    DESVINCULADOS, creyendo que eran «las monedas en oferta». Un producto con
//    tres monedas activas y ningún precio fijado ofrecía una. Medido en dev
//    con el Casco.
//
// 2. LA DECISIÓN. El 2026-10-14 se descartó convertir alegando que mostraría
//    un importe que el tendero nunca escribió. Es falso: su propio formulario
//    ya le muestra esa conversión, calculada igual y marcada con una cadena.
//
// Y `product_currencies` no tiene columna `tier`, así que el caso que planteó
// el dueño —monedas distintas al detal y al mayor— el modelo no lo expresa. Lo
// que cambia entre escalones es el importe.
//
// EL CASO DEL DUEÑO SIGUE PASANDO, y por eso se conserva con sus números: con
// EUR y USDT fijados SOLO al mayor y sin tasa, al detal se ofrece una moneda y
// al mayor tres — igual que antes. Lo que cambia es la razón: no es que el
// detal «no tenga» esas monedas, es que sin tasa no se pueden calcular.
const TRES = ["USD", "EUR", "USDT"];
const SIN_TASA = null;
const TASA = { usd: 100, eur: 120, usdt: null };

check(
  "1e. al detal, sin tasa, solo se ofrece la moneda del precio",
  igual(monedasDelProducto(TRES, elCasoDelDueno.retail, "USD", SIN_TASA), ["USD"]),
  "es el «solo la moneda de pago en dólares» del dueño",
);
check(
  "1f. al mayor se ofrecen las tres, porque están fijadas a mano",
  igual(monedasDelProducto(TRES, elCasoDelDueno.wholesale, "USD", SIN_TASA), TRES),
  JSON.stringify(monedasDelProducto(TRES, elCasoDelDueno.wholesale, "USD", SIN_TASA)),
);
check(
  "1g. CON tasa, el detal ya ofrece el euro: es el fallo que se arregló",
  igual(monedasDelProducto(TRES, elCasoDelDueno.retail, "USD", TASA), ["USD", "EUR"]),
  JSON.stringify(monedasDelProducto(TRES, elCasoDelDueno.retail, "USD", TASA)),
);
check(
  "1h. el USDT se queda fuera aunque esté activo: su tasa no llega aquí",
  !monedasDelProducto(TRES, elCasoDelDueno.retail, "USD", TASA).includes("USDT"),
  "CriptoYa no se llama desde una página pública (2026-10-10)",
);
check(
  "1i. una moneda sin número NO se ofrece, en vez de ofrecerse sin importe",
  monedasDelProducto(["USD", "USDT"], elCasoDelDueno.retail, "USD", TASA).length === 1,
  "ofrecerla mueve el fallo a después de rellenar el formulario",
);
check(
  "1j. la base entra aunque la lista de activas no la traiga",
  igual(monedasDelProducto([], elCasoDelDueno.retail, "USD", SIN_TASA), ["USD"]),
  "una ficha descuadrada no deja un producto sin su propia moneda",
);
check(
  "1k. un bloque sin publicar no ofrece ninguna moneda",
  igual(monedasDelProducto(TRES, null, "USD", TASA), []),
);

// ── 1bis. `precioEnMoneda`, y la reserva 1:1 que no vuelve ──────────────
check(
  "1l. la base no necesita tasa",
  precioEnMoneda(elCasoDelDueno.retail, "USD", "USD", SIN_TASA) === 5,
);
check(
  "1m. un precio FIJADO gana sobre la base y sobre la tasa",
  precioEnMoneda({ price: 5, pinned: { USD: 4 } }, "USD", "USD", TASA) === 4,
  "un candado cerrado es una decisión explícita del tendero",
);
check(
  "1n. SIN TASA NO SE INVENTA UNA",
  precioEnMoneda(elCasoDelDueno.retail, "USD", "EUR", SIN_TASA) === null,
  "la reserva que la pantalla tenía habría devuelto 5 — euros a la par del dólar",
);
check(
  "1o. con tasa, convierte por bolívares igual que `priceIn`",
  precioEnMoneda(elCasoDelDueno.retail, "USD", "EUR", TASA) === 4.17,
  `5 USD a 100/120 = ${precioEnMoneda(elCasoDelDueno.retail, "USD", "EUR", TASA)}`,
);

// ── 2. Sin cantidad mínima: NUNCA el mayor ───────────────────────────────
//
// 3 de los 6 productos de dev con precio de mayor están así. No es teórico.
const sinMinimo = {
  retail: { price: 5, pinned: {} },
  wholesale: { price: 4, pinned: {} },
  wholesale_min_quantity: null,
};
check(
  "2a. sin mínimo, pidiendo 1 se ve el detal",
  escalonParaCantidad(sinMinimo, 1) === "retail",
);
check(
  "2b. sin mínimo, pidiendo 1000 SIGUE siendo el detal",
  escalonParaCantidad(sinMinimo, 1000) === "retail",
  "el lado seguro: un precio mayorista por una unidad es dinero perdido",
);

// ── 3. Productos que solo se venden de una forma ─────────────────────────
const soloDetal = { retail: { price: 5, pinned: {} }, wholesale: null, wholesale_min_quantity: 6 };
const soloMayor = { retail: null, wholesale: { price: 4, pinned: {} }, wholesale_min_quantity: 6 };

check("3a. solo al detal: siempre detal, pida lo que pida", escalonParaCantidad(soloDetal, 99) === "retail");
check("3b. solo al mayor: siempre mayor", escalonParaCantidad(soloMayor, 1) === "wholesale");
check(
  "3c. solo al mayor: no se puede pedir menos del mínimo",
  cantidadMinima(soloMayor) === 6,
  "la ÚNICA barrera dura de la pantalla, y el dueño la pidió expresamente",
);
check(
  "3d. con los dos escalones, se puede pedir 1",
  cantidadMinima(elCasoDelDueno) === 1,
  "aquí pedir poco sí significa algo: es el precio al detal",
);
check(
  "3e. solo al detal, se puede pedir 1 aunque haya un mínimo escrito",
  cantidadMinima(soloDetal) === 1,
  "ese mínimo no gobierna nada si no hay precio de mayor publicado",
);
check(
  "3f. solo al mayor SIN mínimo: se puede pedir 1, no se inventa un umbral",
  cantidadMinima({ ...soloMayor, wholesale_min_quantity: null }) === 1,
);

// ── 4. Lo que no debería pasar nunca, pero la pantalla tiene que sobrevivir ──
check(
  "4. un producto sin ningún precio no devuelve escalón",
  escalonParaCantidad({ retail: null, wholesale: null, wholesale_min_quantity: null }, 1) === null,
  "la función pública ya lo filtra; esto es que la pantalla no reviente si cambia",
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
