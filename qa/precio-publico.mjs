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
  monedasDelBloque,
  precioEnMoneda,
} from "../lib/products/public-pricing.ts";
import { currenciesOf } from "../lib/products/catalog.ts";

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
  // CADA ESCALÓN CON SU BASE Y SU LISTA desde la migración 114. Aquí las dos
  // listas coinciden porque este caso es el del 2026-10-14; el de dos listas
  // distintas —lo que el dueño reportó el 15— va en la sección 1ter.
  retail: { price: 5, pinned: {}, base: "USD", currencies: ["USD", "EUR", "USDT"] },
  wholesale: {
    price: 4,
    pinned: { EUR: 3.6, USDT: 4 },
    base: "USD",
    currencies: ["USD", "EUR", "USDT"],
  },
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
// CURRENCIES BELONG TO THE PRODUCT, NOT TO THE TIER, as of 2026-10-15.
//
// This corrects two things at once, and they are worth separating because one
// was a bug and the other a decision taken on bad information:
//
// 1. THE BUG. `monedasDelEscalon` read `bloque.pinned`, i.e. the UNLINKED
//    prices, believing they were "the currencies on offer". A product with
//    three enabled currencies and no pinned price offered one. Measured in dev
//    with the Casco.
//
// 2. THE DECISION. On 2026-10-14 converting was discarded on the claim that it
//    would show an amount the shopkeeper never typed. That is false: their own
//    form already shows them that conversion, computed the same way and marked
//    with a chain.
//
// And `product_currencies` has no `tier` column, so the case the owner
// described -- different currencies at retail and wholesale -- the model does
// not express. What changes between tiers is the amount.
//
// THE OWNER'S CASE STILL PASSES, which is why it is kept with its numbers:
// with EUR and USDT pinned ONLY at wholesale and no rate, retail offers one
// currency and wholesale three -- same as before. What changes is the reason:
// it is not that retail "does not have" those currencies, it is that without a
// rate they cannot be computed.
const TRES = ["USD", "EUR", "USDT"];
const SIN_TASA = null;
const TASA = { usd: 100, eur: 120, usdt: null };

check(
  "1e. al detal, sin tasa, solo se ofrece la moneda del precio",
  igual(monedasDelBloque(elCasoDelDueno.retail, SIN_TASA), ["USD"]),
  "es el «solo la moneda de pago en dólares» del dueño",
);
check(
  "1f. al mayor se ofrecen las tres, porque están fijadas a mano",
  igual(monedasDelBloque(elCasoDelDueno.wholesale, SIN_TASA), TRES),
  JSON.stringify(monedasDelBloque(elCasoDelDueno.wholesale, SIN_TASA)),
);
check(
  "1g. CON tasa, el detal ya ofrece el euro: es el fallo que se arregló",
  igual(monedasDelBloque(elCasoDelDueno.retail, TASA), ["USD", "EUR"]),
  JSON.stringify(monedasDelBloque(elCasoDelDueno.retail, TASA)),
);
check(
  "1h. el USDT se queda fuera aunque esté activo: su tasa no llega aquí",
  !monedasDelBloque(elCasoDelDueno.retail, TASA).includes("USDT"),
  "CriptoYa no se llama desde una página pública (2026-10-10)",
);
check(
  "1i. una moneda sin número NO se ofrece, en vez de ofrecerse sin importe",
  igual(
    monedasDelBloque({ ...elCasoDelDueno.retail, currencies: ["USD", "USDT"] }, TASA),
    ["USD"],
  ),
  "ofrecerla mueve el fallo a después de rellenar el formulario",
);

// ── 1ter. LO QUE EL DUEÑO REPORTÓ EL 2026-10-15 ─────────────────────────
//
// «Un producto puede tener los tres precios al detal pero solo uno al mayor.»
// Antes de la migración 114 esto NO se podía expresar: `product_currencies`
// no tenía `tier`, las dos listas eran la misma, y quitar una moneda de un
// escalón la quitaba del otro.
//
// La prueba 1j de abajo es su complemento y la que de verdad lo demuestra:
// las dos listas pueden tener BASES distintas, que es lo que el dueño eligió
// el 2026-10-15 cuando se le plantearon las dos lecturas de su frase.
const tresYUna = {
  retail: { price: 5, pinned: {}, base: "USD", currencies: ["USD", "EUR", "USDT"] },
  wholesale: { price: 4.4, pinned: {}, base: "EUR", currencies: ["EUR"] },
  wholesale_min_quantity: 6,
};
check(
  "1p. al detal se ofrecen las suyas, sin contagiarse del mayor",
  igual(monedasDelBloque(tresYUna.retail, TASA), ["USD", "EUR"]),
  `${JSON.stringify(monedasDelBloque(tresYUna.retail, TASA))} — el USDT se cae por no tener tasa, no por el escalón`,
);
check(
  "1q. al mayor se ofrece SOLO la suya, aunque el detal tenga tres",
  igual(monedasDelBloque(tresYUna.wholesale, TASA), ["EUR"]),
  JSON.stringify(monedasDelBloque(tresYUna.wholesale, TASA)),
);
check(
  "1r. y cada escalón se cotiza con SU base, no con la del otro",
  precioEnMoneda(tresYUna.wholesale, "EUR", TASA) === 4.4 &&
    precioEnMoneda(tresYUna.retail, "USD", TASA) === 5,
  "4,40 € al mayor son 4,40 €, no la conversión de 4,40 dólares",
);
check(
  "1s. el mayor en euros NO vale 4,40 dólares — es la clase de error que esto evita",
  precioEnMoneda(tresYUna.wholesale, "USD", TASA) !== 4.4,
  `convertido da ${precioEnMoneda(tresYUna.wholesale, "USD", TASA)}`,
);
check(
  "1j. la base entra aunque la lista de activas no la traiga",
  igual(monedasDelBloque(elCasoDelDueno.retail, SIN_TASA), ["USD"]),
  "una ficha descuadrada no deja un producto sin su propia moneda",
);
check(
  "1k. un bloque sin publicar no ofrece ninguna moneda",
  igual(monedasDelBloque(null, TASA), []),
);

// ── 1bis. `precioEnMoneda`, and the 1:1 fallback that does not come back ─
check(
  "1l. la base no necesita tasa",
  precioEnMoneda(elCasoDelDueno.retail, "USD", SIN_TASA) === 5,
);
check(
  "1m. un precio FIJADO gana sobre la base y sobre la tasa",
  precioEnMoneda({ price: 5, pinned: { USD: 4 } }, "USD", "USD", TASA) === 4,
  "un candado cerrado es una decisión explícita del tendero",
);
check(
  "1n. SIN TASA NO SE INVENTA UNA",
  precioEnMoneda(elCasoDelDueno.retail, "EUR", SIN_TASA) === null,
  "la reserva que la pantalla tenía habría devuelto 5 — euros a la par del dólar",
);
check(
  "1o. con tasa, convierte por bolívares igual que `priceIn`",
  precioEnMoneda(elCasoDelDueno.retail, "EUR", TASA) === 4.17,
  `5 USD a 100/120 = ${precioEnMoneda(elCasoDelDueno.retail, "EUR", TASA)}`,
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

// ── 5. LA LISTA QUE ABRE LA FICHA DEL TENDERO ───────────────────────────
//
// `currenciesOf` decide, para cada escalón, qué monedas se ven y CUÁL ES LA
// BASE — porque `TierSection` deriva la suya con `currencies[0]`. O sea que un
// fallo de orden aquí no se ve como una lista rara: se ve como el tendero
// escribiendo el precio en la moneda equivocada.
//
// ANTES DE LA MIGRACIÓN 114 EL ORDEN LO FIJABA UNA LISTA CONSTANTE
// —`["USD","EUR","USDT","COP"]`— y daba igual, porque la base era del producto
// y venía de otro sitio. Con una base por escalón eso se vuelve un fallo
// silencioso: un producto con el mayor en euros que además ofrezca dólares
// habría puesto el dólar primero, por orden alfabético, y el tendero habría
// escrito su precio al mayor en dólares creyendo que eran euros.
//
// Es lógica pura y sin base de datos, que es lo único de este cambio que se
// puede probar sin una sesión del tendero: la ficha está detrás de login.
const FILAS = [
  { product_id: "p1", tier: "retail", currency: "USD" },
  { product_id: "p1", tier: "retail", currency: "EUR" },
  { product_id: "p1", tier: "retail", currency: "USDT" },
  { product_id: "p1", tier: "wholesale", currency: "EUR" },
  { product_id: "p2", tier: "retail", currency: "COP" },
];

check(
  "5a. el detal trae las suyas, con su base primera",
  igual(currenciesOf(FILAS, "p1", "retail", "USD"), ["USD", "EUR", "USDT"]),
  JSON.stringify(currenciesOf(FILAS, "p1", "retail", "USD")),
);
check(
  "5b. el mayor trae SOLO las suyas — no se contagia del detal",
  igual(currenciesOf(FILAS, "p1", "wholesale", "EUR"), ["EUR"]),
  JSON.stringify(currenciesOf(FILAS, "p1", "wholesale", "EUR")),
);
check(
  "5c. LA BASE VA PRIMERA aunque el orden constante la pusiera después",
  igual(currenciesOf(FILAS, "p1", "retail", "EUR"), ["EUR", "USD", "USDT"]),
  `${JSON.stringify(currenciesOf(FILAS, "p1", "retail", "EUR"))} — con el orden viejo habría salido USD primero, y el precio se habría escrito en dólares`,
);
check(
  "5d. la base entra aunque no tenga fila propia",
  igual(currenciesOf(FILAS, "p1", "wholesale", "USDT"), ["USDT", "EUR"]),
  "una ficha descuadrada no deja un escalón sin la moneda en la que guarda su precio",
);
check(
  "5e. un producto sin filas se queda solo con su base",
  igual(currenciesOf(FILAS, "p9", "retail", "COP"), ["COP"]),
);
check(
  "5f. no se cuela la moneda de OTRO producto",
  !currenciesOf(FILAS, "p1", "retail", "USD").includes("COP"),
  "p2 tiene COP al detal y p1 no",
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
