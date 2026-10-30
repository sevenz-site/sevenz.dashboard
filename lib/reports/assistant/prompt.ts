import { formatDinero } from "@/lib/reports/ganancia";
import type { FactsForTheModel, MoneyByLedger } from "@/lib/reports/assistant/facts";
import { MAX_CHARS } from "@/lib/reports/assistant/fallback";

/**
 * Lo que se le PIDE al modelo, por debajo del tope real de 450.
 *
 * Medido el 2026-10-30 en la primera tanda real: pidiéndole 450 escribió 465 y
 * la respuesta se tiró entera. Un modelo no cuenta caracteres, los estima; la
 * holgura es lo que convierte una estimación corta en un texto válido en vez de
 * en un resumen perdido.
 *
 * El tope DURO sigue siendo `MAX_CHARS` y se comprueba en `validate.ts`: esto
 * no lo relaja, solo deja de rozarlo.
 */
const PRESUPUESTO_SUGERIDO = MAX_CHARS - 60;

// ═══════════════════════════════════════════════════════════════════════
// WHAT THE MODEL IS TOLD, AND THE SHORT LIST OF THINGS IT MAY WRITE
//
// ───────────────────────────────────────────────────────────────────────
// THE FACTS ARE PRE-RENDERED. THE MODEL NEVER FORMATS A NUMBER.
//
// Every figure reaches the prompt ALREADY WRITTEN the way the app writes it --
// «$11.852,69», not `11852.69`. Three things follow from that, and the third
// is the one that matters:
//
//   · The model cannot pick a thousands separator, so it cannot invent the
//     one shape a Venezuelan shopkeeper would read as a different number.
//   · It cannot add two currencies, because it never sees two addable things.
//   · And `validate.ts` can then check the output against this exact list of
//     strings. A model that is handed `11852.69` and writes «$11.852,69» would
//     be correct and unverifiable; one handed the finished string either
//     copies it or is caught.
//
// ───────────────────────────────────────────────────────────────────────
// WHY THE LADDER IS IN THE PROMPT AND NOT ONLY IN THE FALLBACK
//
// With 450 characters only three recommendations fit, so something must decide
// WHICH three when four things are wrong. Left to itself a model picks the most
// dramatic; the owner's order picks the most expensive to ignore.
//
// ───────────────────────────────────────────────────────────────────────
// THE TONE IS A REQUIREMENT, NOT A PREFERENCE
//
// Owner, 2026-10-29: *«El asistente debe ser de tono neutro in-app, no
// alarmista»*. It matches the brand's own rule — in-app copy about money is
// neutral; the jokes live in marketing. These are somebody's real debts, and a
// screen that dramatises them gets closed.
// ═══════════════════════════════════════════════════════════════════════

/** A labelled fact: what the model may say, and the exact text it must copy. */
export type Hecho = { etiqueta: string; valor: string };

function dineroPorLibro(m: MoneyByLedger): string | null {
  const partes = Object.entries(m)
    .filter(([, amount]) => typeof amount === "number" && amount !== 0)
    .map(([currency, amount]) => formatDinero({ currency, amount: amount as number }));
  return partes.length ? partes.join(" y ") : null;
}

/**
 * The facts, flattened into the list the model is given AND the list
 * `validate.ts` checks against. One function builds both on purpose: two lists
 * would drift, and the drift would show up as a correct summary being rejected.
 */
export function hechosEnTexto(f: FactsForTheModel): Hecho[] {
  const out: Hecho[] = [];
  const add = (etiqueta: string, valor: string | number | null) => {
    if (valor == null) return;
    if (typeof valor === "number" && valor === 0) return;
    out.push({ etiqueta, valor: String(valor) });
  };

  add("Por cobrar hoy en total", dineroPorLibro(f.receivable));
  add("Clientes con el plazo por vencer", f.clients.dueSoon);
  add("Clientes con el plazo vencido", f.clients.overdue);
  add("Clientes en estado crítico (más de 30 días sin abonar)", f.clients.critical);
  add("Clientes marcados como mala paga", f.clients.flagged);
  add("Clientes sin plazo acordado", f.clients.noTerm);

  add(`Cobrado de contado en los últimos ${f.windowDays} días`, dineroPorLibro(f.collectedCash));
  add(`Abonado sobre deudas en los últimos ${f.windowDays} días`, dineroPorLibro(f.collectedOnDebt));
  add(`Fiado en los últimos ${f.windowDays} días`, dineroPorLibro(f.lent));

  add("Productos disponibles", f.stock.available);
  add(`Productos por agotarse (${f.stock.threshold} unidades o menos)`, f.stock.runningLow);
  add("Referencias agotadas", f.stock.outOfStock);
  // LA ETIQUETA DICE LA FRASE ENTERA, no un recuento suelto.
  //
  // Era «De los más vendidos, cuántos están por agotarse» y el 2026-10-30 el
  // modelo la juntó con la de arriba: escribió «los 3 productos por agotarse
  // QUE ESTÁN ENTRE LOS MÁS VENDIDOS» cuando por agotarse hay 3 y entre los
  // más vendidos solo 1.
  //
  // Y ESO LA VALIDACIÓN NO LO CAZA, que es lo que lo hace peligroso: el `3` es
  // una cifra legítima de los hechos, así que pasa. Lo que estaba mal era la
  // AFIRMACIÓN, no el número, y comprobar afirmaciones no se puede. Lo único
  // que lo evita es no dejar dos etiquetas que se puedan encadenar.
  add(
    "Productos que están A LA VEZ entre los más vendidos y por agotarse",
    f.stock.bestSellersRunningLow,
  );

  add(`Vendido por catálogo en los últimos ${f.windowDays} días`, dineroPorLibro(f.catalogSales));
  add("Pedidos del catálogo sin atender", f.unhandledOrders);
  add("Proveedores con margen calculable", f.suppliers.withComputableMargin);
  add(
    "Margen más bajo entre proveedores, en %",
    f.suppliers.lowestMarginPct == null ? null : Math.round(f.suppliers.lowestMarginPct),
  );
  add(
    "Margen más alto entre proveedores, en %",
    f.suppliers.highestMarginPct == null ? null : Math.round(f.suppliers.highestMarginPct),
  );

  add("Buenos pagadores que llevan más de 30 días sin comprar", f.dormantGoodPayers);
  add("Productos sin costo anotado", f.gaps.productsWithoutCost);
  add("Productos sin cantidad anotada", f.gaps.productsUncounted);

  return out;
}

export function construirPrompt(f: FactsForTheModel): string {
  const hechos = hechosEnTexto(f)
    .map((h) => `- ${h.etiqueta}: ${h.valor}`)
    .join("\n");

  return `Eres el asistente de la app Sevenz, que usan tenderos y dueños de bodegas en Venezuela y Colombia para llevar el fiado de sus clientes. Escribes en español de Venezuela, en segunda persona («tienes», «cóbrale»).

Tu trabajo es leer los datos de abajo y escribir un resumen muy corto de cómo va el negocio en los últimos ${f.windowDays} días, con recomendaciones de qué hacer.

DATOS DEL NEGOCIO (son los únicos que existen; no hay más):
${hechos}

REGLAS QUE NO PUEDES ROMPER:

0. LO DE LA IZQUIERDA DE CADA DOS PUNTOS ES UNA DESCRIPCIÓN PARA TI, NO TEXTO PARA COPIAR. Copia los VALORES, nunca las etiquetas. Escribe frases normales, como se las dirías a alguien en el mostrador. Mal: «Tienes por cobrar hoy en total: $60,00 y hay clientes con el plazo vencido: 2». Bien: «Tienes $60,00 por cobrar y 2 clientes con el plazo vencido».
1. NO CALCULES NADA. No sumes, no restes, no dividas, no saques porcentajes ni promedios. Solo puedes copiar las cifras de la lista de arriba, exactamente como están escritas, con sus símbolos y sus puntos y comas.
2. NO INVENTES NINGÚN NÚMERO. Si una cifra no está en la lista, no existe y no la puedes mencionar. Tampoco inventes fechas.
3. NUNCA SUMES DOS MONEDAS. Si hay dólares y euros, se nombran por separado o no se nombran.
4. NO NOMBRES A NINGÚN CLIENTE, PRODUCTO, PROVEEDOR NI NEGOCIO. No tienes esos nombres y no debes inventarlos. Habla por categorías: «los clientes en estado crítico», «los productos más vendidos».
5. TONO NEUTRO. Nada de alarmas, de signos de exclamación, ni de palabras como «riesgo», «peligro», «urgente» o «quiebra». Es el dinero real de alguien y la app no lo dramatiza.
6. NO RECOMIENDES ANOTAR COSTOS NI CANTIDADES. La pantalla ya avisa de eso justo debajo. Si faltan datos, dilo solo como advertencia al final del resumen («el margen que ves es parcial»), nunca como recomendación.

EN QUÉ ORDEN ELEGIR QUÉ DECIR. Solo caben tres recomendaciones, así que si varias cosas van mal, manda la de arriba:

1. Que no pierda lo que ya prestó: clientes críticos, con plazo vencido, o marcados como mala paga.
2. Que no se le pare la caja: que esté fiando más de lo que cobra, o que se le estén agotando los productos que más vende.
3. Que venda más: pedidos del catálogo sin atender, márgenes bajos.
4. Que no pierda clientes buenos: buenos pagadores que dejaron de comprar.

CADA RECOMENDACIÓN TIENE QUE DECIR ALGO QUE HACER HOY, con un dato concreto detrás. Si no te quedan datos, escribe menos: es mejor UNA recomendación buena que tres, dos de ellas genéricas. Ejemplos de lo que NO vale, porque no dicen qué hacer ni a quién: «Revisa los montos pendientes para mantener la caja activa», «Monitorea tus ventas», «Mantén un buen control de tu inventario».

Si no hay nada preocupante, escribe igual pero de lo bueno, y deja la lista de recomendaciones vacía.

LARGO: el resumen más las recomendaciones, juntos, tienen que caber en ${PRESUPUESTO_SUGERIDO} caracteres. Cuéntalos. Es mejor decir menos que pasarte.

Contesta SOLO con este JSON, sin nada más:
{"summary": "una o dos frases de diagnóstico", "recommendations": ["...", "...", "..."]}`;
}
