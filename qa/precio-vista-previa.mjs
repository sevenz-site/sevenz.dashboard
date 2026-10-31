// NO HABLA CON NINGUNA BASE DE DATOS. Lógica pura, corre en cualquier entorno.
//
// LA LÍNEA DE PRECIO DE LA VISTA PREVIA DE UN PRODUCTO COMPARTIDO — encargo del
// dueño el 2026-10-30. El riesgo que esta suite vigila es el mismo que el de
// `qa:precio-publico` y por eso son hermanas: una vista previa que dice una
// cifra y una página que dice otra no se reporta, el cliente simplemente
// desconfía. Y es peor que no tener precio, porque se lee en el chat, antes de
// abrir nada.
//
// LA PARTE QUE MÁS VALE es la última: que la cifra de la vista previa sea LA
// MISMA que `precioEnMoneda` da para la página, comparada con la función y no
// con un número tecleado aquí.

import { previewPriceLine } from "../lib/products/preview-price.ts";
import { precioEnMoneda, bloqueDesdeRpc } from "../lib/products/public-pricing.ts";
import { formatPriceAmount } from "../lib/products/price.ts";

let fallos = 0;
function check(nombre, pasa, detalle) {
  if (!pasa) fallos++;
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const US = "🇺🇸";
const EU = "🇪🇺";
const CO = "🇨🇴";
const RATES = { usd: 100, eur: 120 };

const retail = (price, currencies, base = "USD", pinned = {}) => ({
  price,
  pinned,
  base_currency: base,
  currencies,
});

// ── 1. EL CASO DEL FRAME: dólar y euro ──────────────────────────────────
const ambos = previewPriceLine({
  retail: retail(12, ["USD", "EUR"]),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "USD",
  rates: RATES,
});
console.log("    →", JSON.stringify(ambos));
check("dólar y euro, cada uno con su bandera", ambos?.startsWith(US) && ambos.includes(EU), ambos);
check("el euro sale convertido a la tasa, no copiado", ambos?.includes("10,00") || ambos?.includes("10.00"), ambos);

// ── 2. SOLO LO QUE EL TENDERO OFRECE ────────────────────────────────────
const soloDolar = previewPriceLine({
  retail: retail(12, ["USD"]),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "USD",
  rates: RATES,
});
check("con solo el dólar activado no aparece el euro", soloDolar != null && !soloDolar.includes(EU), soloDolar);

// ── 3. SIN TASA NO SE INVENTA UNA MONEDA ────────────────────────────────
const sinTasa = previewPriceLine({
  retail: retail(12, ["USD", "EUR"]),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "USD",
  rates: null,
});
check("sin tasa el euro no se ofrece (no hay 1:1 de relleno)", sinTasa != null && !sinTasa.includes(EU), sinTasa);

// ── 4. COLOMBIA: sus pesos y nada más ───────────────────────────────────
const colombia = previewPriceLine({
  retail: retail(15000, ["COP"], "COP"),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "COP",
  rates: null,
});
check("un negocio colombiano enseña sus pesos", colombia?.startsWith(CO) === true, colombia);

// ── 5. SOLO AL MAYOR: dice que es al mayor y desde cuánto ───────────────
const soloMayor = previewPriceLine({
  retail: null,
  wholesale: retail(4, ["USD"]),
  wholesale_min_quantity: 6,
  base_currency: "USD",
  rates: RATES,
});
check("solo al mayor, lo dice y dice desde cuántas unidades", soloMayor?.endsWith("al mayor (desde 6)") === true, soloMayor);

// ── 6. DETAL Y MAYOR: se ve el de detal, sin la etiqueta ────────────────
const losDos = previewPriceLine({
  retail: retail(5, ["USD"]),
  wholesale: retail(4, ["USD"]),
  wholesale_min_quantity: 6,
  base_currency: "USD",
  rates: RATES,
});
check("con los dos escalones sale el de detal", losDos != null && !losDos.includes("al mayor") && losDos.includes("5"), losDos);

// ── 7. SIN PRECIO, SIN LÍNEA ────────────────────────────────────────────
check(
  "sin ningún escalón no hay línea",
  previewPriceLine({ retail: null, wholesale: null, wholesale_min_quantity: null, base_currency: "USD", rates: RATES }) === null,
);
check(
  "un precio en cero no se enseña como gratis",
  previewPriceLine({ retail: retail(0, ["USD"]), wholesale: null, wholesale_min_quantity: null, base_currency: "USD", rates: RATES }) === null,
);

// ── 8. BASE EN BOLÍVARES: ni dólar ni euro, cae a la base ───────────────
const enBs = previewPriceLine({
  retail: retail(1000, ["VES"], "VES"),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "VES",
  rates: RATES,
});
check("un producto en bolívares no queda sin precio", enBs != null && enBs.length > 0, enBs);

// ── 9. UN PRECIO FIJADO A MANO MANDA SOBRE LA CONVERSIÓN ────────────────
const fijado = previewPriceLine({
  retail: retail(12, ["USD", "EUR"], "USD", { EUR: 9 }),
  wholesale: null,
  wholesale_min_quantity: null,
  base_currency: "USD",
  rates: RATES,
});
check("el euro fijado a mano (9) gana al calculado (10)", fijado != null && (fijado.includes("9,00") || fijado.includes("9.00")), fijado);

// ── 10. LA MISMA CIFRA QUE LA PÁGINA ────────────────────────────────────
// Comparada con `precioEnMoneda`, la función que usa la página, y no con un
// número escrito a mano: si alguien cambia una de las dos, esta fila se pone
// roja.
const bloque = bloqueDesdeRpc(retail(12, ["USD", "EUR"]), "USD");
const rates = { ...RATES, usdt: null };
const deLaPagina = formatPriceAmount(precioEnMoneda(bloque, "EUR", rates), "EUR");
check("el euro de la vista previa es el que calcula la página", ambos?.includes(deLaPagina) === true, deLaPagina);

console.log(fallos === 0 ? "\nTODO PASA" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
