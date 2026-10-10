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

import {
  allPrices,
  priceIn,
  suggestedPrice,
  marginFromPrice,
  parseAmount,
  formatAmountForInput,
} from "../lib/products/price.ts";

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

// ── 7. El parser de cantidades, que ya rompió el dinero una vez ──────────
//
// El 2026-10-10 la ficha guardaba 11,50 al mayor y, al volver a abrirla,
// enseñaba un margen del 1.050 %. El parser quitaba los puntos como si
// siempre fueran separadores de miles, así que el "11.5" que devuelve la base
// —un número de JS se convierte a texto CON PUNTO— se leía como 115. El mismo
// parser estaba en el servidor: el siguiente guardado habría escrito 115 en la
// fila. Un producto de $11,50 pasaba a $115 por abrirlo y guardarlo.
//
// La regla ahora es una sola: **el último separador es el decimal**. Estos
// casos son los que la fijan, y el primero es el que falló.
const CASOS_PARSER = [
  ["11.5", 11.5, "lo que devuelve la base de datos — EL PRIMER CASO QUE ROMPIÓ"],
  ["11,5", 11.5, "lo que teclea un venezolano"],
  ["12.000", 12000, "doce mil bolívares — EL SEGUNDO CASO QUE ROMPIÓ"],
  ["12,000", 12000, "doce mil con el otro separador"],
  ["1.234,56", 1234.56, "miles con punto, decimal con coma"],
  ["1,234.56", 1234.56, "al revés, y también sale bien"],
  ["1.234.567", 1234567, "varios del mismo tipo: todos son miles"],
  ["13", 13, "sin separador"],
  ["0,5", 0.5, "menor que uno"],
  ["", null, "vacío no es cero"],
  ["abc", null, "basura no es cero"],
  [null, null, "ausente no es cero"],
];

for (const [entrada, esperado, porque] of CASOS_PARSER) {
  const r = parseAmount(entrada);
  const pasa = esperado === null ? r === null : Math.abs(r - esperado) < 1e-9;
  check(`7. parseAmount(${JSON.stringify(entrada)}) → ${esperado} — ${porque}`, pasa, String(r));
}

// Y la vuelta: lo que se guardó se enseña en el campo como se escribe aquí.
check("8a. 11,5 se enseña con coma en el campo", formatAmountForInput(11.5) === "11,5");
check("8b. un entero no gana decimales", formatAmountForInput(13) === "13");
check("8c. sin valor, campo vacío", formatAmountForInput(null) === "");
// La ida y vuelta completa, que es lo que la pantalla hace al abrir una ficha.
// LA IDA Y VUELTA COMPLETA, que es lo que la pantalla hace al abrir una ficha.
// El caso de 1,125 es el que obliga al cero de más en `formatAmountForInput`:
// sin él, tres decimales se leerían como miles y 1,125 kilos volverían como
// 1.125. Es la pareja que sobrevive a que alguien cambie solo una mitad.
const IDA_Y_VUELTA = [11.5, 1234.56, 12000, 13, 0.5, 1.125, 0.25];
for (const n of IDA_Y_VUELTA) {
  check(
    `8d. ${n} → "${formatAmountForInput(n)}" → ${parseAmount(formatAmountForInput(n))}`,
    parseAmount(formatAmountForInput(n)) === n,
  );
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
