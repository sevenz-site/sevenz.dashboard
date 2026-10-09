// NO TOCA NINGUNA BASE DE DATOS. Son funciones puras: se comprueban con
// números y se acabó. Por eso puede correr antes de que la migración 083 esté
// aplicada en ningún sitio.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que el candado mande. Si el tendero fijó un precio a mano, ese número no
//      se recalcula nunca. Lo contrario —reescribirle por detrás algo que puso
//      a propósito— es lo que hace que se deje de confiar en la pantalla.
//
//   2. Que las conversiones pivoten sobre el bolívar. No existe una tasa
//      USD→EUR en todo el producto; hay Bs/USD y Bs/EUR. Si alguien "optimiza"
//      esto con una tasa cruzada, se la habrá inventado.
//
//   3. Que una tasa que falta devuelva null y no un número. El precio del USDT
//      se pide en vivo y puede no estar —CriptoYa caído, o un precio fuera de
//      banda que la ruta descarta a propósito—. Un null se puede enseñar como
//      hueco; un 0 o un NaN se enseña como precio.
//
//   4. Que Colombia no reciba equivalencias. No hay Bs/COP porque no hay
//      bolívares de por medio, y cualquier cosa que se pusiera ahí sería
//      inventada.
//
//   5. Que el margen sea sobre el COSTO. «Al monto que me costó le aplico un
//      30 %», dijeron los dos tenderos. Margen sobre el precio de venta da otro
//      número y es la confusión clásica de esta cuenta.

import { allPrices, priceIn, suggestedPrice, marginFromPrice } from "../lib/products/price.ts";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// Tasas realistas de un dueño en BCV_AUTO, con el USDT por encima del oficial,
// que es la situación normal en Venezuela.
const TASAS = { usd: 160, eur: 180, usdt: 200 };
const BASE = { amount: 12, currency: "USD" };

// ── 1. La moneda base se devuelve tal cual ────────────────────────────────
const enUsd = priceIn("USD", BASE, TASAS);
check(
  "1. la moneda tecleada se devuelve sin tocar, marcada como base",
  enUsd.amount === 12 && enUsd.origin === "base",
  JSON.stringify(enUsd),
);

// ── 2. Las conversiones pivotan sobre el bolívar ──────────────────────────
// $12 × 160 = Bs 1.920. Entre 180 = €10,67. Entre 200 = 9,60 USDT.
const enEur = priceIn("EUR", BASE, TASAS);
const enVes = priceIn("VES", BASE, TASAS);
const enUsdt = priceIn("USDT", BASE, TASAS);
check("2a. a euros: 12 × 160 ÷ 180 = 10,67", enEur.amount === 10.67, String(enEur.amount));
check("2b. a bolívares: 12 × 160 = 1.920", enVes.amount === 1920, String(enVes.amount));
check("2c. a USDT: 12 × 160 ÷ 200 = 9,60", enUsdt.amount === 9.6, String(enUsdt.amount));
check(
  "2d. las tres salen marcadas como calculadas",
  [enEur, enVes, enUsdt].every((p) => p.origin === "derived"),
);

// Ida y vuelta: euros → dólares tiene que devolver lo mismo.
const vuelta = priceIn("USD", { amount: enEur.amount, currency: "EUR" }, TASAS);
check(
  "2e. ida y vuelta USD → EUR → USD devuelve el original",
  Math.abs(vuelta.amount - 12) < 0.01,
  `${vuelta.amount}`,
);

// ── 3. El candado manda ───────────────────────────────────────────────────
const fijado = priceIn("USDT", BASE, TASAS, { USDT: 12.5 });
check(
  "3a. un precio fijado a mano NO se recalcula",
  fijado.amount === 12.5 && fijado.origin === "manual",
  JSON.stringify(fijado),
);
const otraSinFijar = priceIn("EUR", BASE, TASAS, { USDT: 12.5 });
check(
  "3b. y fijar uno no afecta a los demás",
  otraSinFijar.amount === 10.67 && otraSinFijar.origin === "derived",
);
// B, según el dueño, es "todos los candados cerrados" — no hay interruptor
// aparte que construir.
const todosFijados = allPrices(BASE, TASAS, { USD: 10, USDT: 10.5, EUR: 9.5, VES: 2000 });
check(
  "3c. con los cuatro candados cerrados, los cuatro son manuales",
  todosFijados.every((p) => p.origin === "manual"),
  todosFijados.map((p) => `${p.currency}:${p.amount}`).join(" "),
);

// ── 4. Una tasa que falta devuelve null, no un número ─────────────────────
const sinUsdt = priceIn("USDT", BASE, { ...TASAS, usdt: null });
check(
  "4a. sin precio de USDT devuelve null, no 0 ni NaN",
  sinUsdt.amount === null,
  String(sinUsdt.amount),
);
const sinUsdtPeroFijado = priceIn("USDT", BASE, { ...TASAS, usdt: null }, { USDT: 11 });
check(
  "4b. pero si estaba fijado a mano, se enseña igual",
  sinUsdtPeroFijado.amount === 11,
);
const filaConHueco = allPrices(BASE, { ...TASAS, usdt: null });
check(
  "4c. la moneda sin tasa viene con null en vez de omitirse",
  filaConHueco.length === 4 && filaConHueco.find((p) => p.currency === "USDT").amount === null,
  `monedas: ${filaConHueco.map((p) => p.currency).join(",")}`,
);

// ── 5. Colombia no recibe equivalencias ───────────────────────────────────
const colombia = allPrices({ amount: 50000, currency: "COP" }, TASAS);
check(
  "5. un negocio colombiano recibe UNA entrada, la suya",
  colombia.length === 1 && colombia[0].currency === "COP" && colombia[0].amount === 50000,
  JSON.stringify(colombia),
);

// ── 6. Costo y margen ─────────────────────────────────────────────────────
check("6a. costo 12 con 30 % sugiere 15,60", suggestedPrice(12, 30) === 15.6);
check("6b. costo 12 con 0 % sugiere 12", suggestedPrice(12, 0) === 12);
check("6c. sin costo no se sugiere nada", suggestedPrice(0, 30) === null);
check(
  "6d. el margen es SOBRE EL COSTO: de 10 a 13 son 30 %, no 23 %",
  marginFromPrice(10, 13) === 30,
  String(marginFromPrice(10, 13)),
);
check(
  "6e. sin costo no hay margen — el caso de todo producto nacido en un fiado",
  marginFromPrice(null, 13) === null,
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
