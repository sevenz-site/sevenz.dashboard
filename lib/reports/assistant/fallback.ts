import { formatDinero } from "@/lib/reports/ganancia";
import type { FactsForTheModel, MoneyByLedger } from "@/lib/reports/assistant/facts";

// ═══════════════════════════════════════════════════════════════════════
// THE SUMMARY WITHOUT THE MODEL
//
// Same shape, same four motivators, same tone -- written in TypeScript from the
// same facts. It is what the shopkeeper reads when Gemini fails, when the daily
// quota is spent, or when the generated text does not survive validation.
//
// ───────────────────────────────────────────────────────────────────────
// WHY IT EXISTS AT ALL, which is not "to be safe"
//
// The owner asked for the banner to be *«expandido por defecto siempre que se
// entre a la funcionalidad de Reportes»*. A banner that is always open and
// sometimes empty is worse than no banner: it reads as a screen that broke.
// This file is what makes "always" true without depending on a third party
// being up.
//
// It also sets the floor for the whole feature. If the AI half were ever
// dropped, what is written here is still a useful screen -- and that is
// deliberate, because it means step 4 of the plan can ship and be looked at
// before a single token is spent.
//
// ───────────────────────────────────────────────────────────────────────
// THE LADDER IS THE PRODUCT DECISION, NOT THE PROSE
//
// Four motivators, agreed with the owner on 2026-10-29, and the ORDER is the
// point: with 450 characters only three recommendations fit, so something has
// to decide which three when several things are wrong at once.
//
//   1. That he does not lose what he already lent.
//   2. That the till keeps moving -- he lends more than he collects, or the
//      shelf empties.
//   3. That he sells more. Only when 1 and 2 are healthy.
//   4. That he does not lose good clients.
//
// 1 AND 2 ARE NOT THE SAME THING, and that distinction was missing from the
// original brief: 1 is money that already left and may not come back; 2 is
// whether he can restock tomorrow. A shop can collect well and still run out
// of stock.
//
// ───────────────────────────────────────────────────────────────────────
// WHAT IT NEVER SAYS
//
// *«Te faltan costos por anotar»*. The Inventario tab already says that, in
// amber, two inches below this banner. Repeating it would be the assistant
// reading the screen back to its reader. Missing data leaves as a confidence
// caveat on the margin sentence -- never as a recommendation.
//
// And the tone is the in-app one the owner asked for: *«tono neutro in-app, no
// alarmista»*. No "riesgo", no "peligro", no exclamation marks. These are
// somebody's real debts.
// ═══════════════════════════════════════════════════════════════════════

export type AssistantNote = { summary: string; recommendations: string[] };

/**
 * The owner's cap: *«Máximo 450 caracteres incluyendo espacio»*.
 *
 * Counted over the GENERATED text -- the summary plus every recommendation.
 * The literal «Recomendaciones:» is chrome the screen writes, not something a
 * model produced, so it does not eat the budget. Measured against the frame's
 * own example, which lands at about 415 by this count.
 */
export const MAX_CHARS = 450;

export function noteLength(n: AssistantNote): number {
  return n.summary.length + n.recommendations.join("").length;
}

/** Trims recommendations off the end until the note fits. Never cuts mid-sentence. */
export function trimToBudget(n: AssistantNote): AssistantNote {
  const recs = [...n.recommendations];
  while (recs.length && noteLength({ summary: n.summary, recommendations: recs }) > MAX_CHARS) {
    recs.pop();
  }
  return { summary: n.summary, recommendations: recs };
}

// ── LOS DOS PLURALES, Y HACEN FALTA LOS DOS ───────────────────────────
//
// `cuantos` cuenta: «1 cliente», «3 clientes».
// `losCuantos` señala: «el cliente», «los 3 clientes».
//
// Son distintos porque el español mete el artículo ENTRE la preposición y el
// número, y una sola función produce «Empieza por 2 los clientes», que es lo
// que salió la primera vez que se corrió esta suite.
function cuantos(n: number, singular: string, muchos: string): string {
  return `${n} ${n === 1 ? singular : muchos}`;
}

function losCuantos(n: number, elSingular: string, losMuchos: string): string {
  return n === 1 ? elSingular : `${losMuchos.replace("N", String(n))}`;
}

/**
 * «A», «A y B», «A, B y C».
 *
 * Unir con `", y "` daba «tienes X por cobrar, y 19 clientes llevan…, y en
 * estos 7 días fiaste…»: en español la conjunción va SOLO antes del último.
 * Salió al leer el primer resumen real en pantalla, no de pensarlo.
 */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Writes a per-ledger amount without ever summing two currencies. */
function dinero(m: MoneyByLedger): string {
  const partes = Object.entries(m)
    .filter(([, amount]) => typeof amount === "number" && amount !== 0)
    .map(([currency, amount]) => formatDinero({ currency, amount: amount as number }));
  return partes.join(" y ");
}

function suma(a: MoneyByLedger, b: MoneyByLedger): MoneyByLedger {
  const out: MoneyByLedger = {};
  for (const m of [a, b]) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v !== "number") continue;
      out[k as keyof MoneyByLedger] = (out[k as keyof MoneyByLedger] ?? 0) + v;
    }
  }
  return out;
}

/**
 * Did he lend more than he collected, in ANY ledger?
 *
 * Per ledger and never on a total, which is the rule across this whole app: a
 * shop can collect well in dollars and badly in euros, and a single answer for
 * both would be wrong for one of them.
 */
function prestoMasDeLoQueCobro(f: FactsForTheModel): boolean {
  const cobrado = suma(f.collectedCash, f.collectedOnDebt);
  return f.ledgers.some((libro) => (f.lent[libro] ?? 0) > (cobrado[libro] ?? 0));
}

export function buildFallbackNote(f: FactsForTheModel): AssistantNote {
  if (f.empty) {
    return {
      summary:
        "Todavía no has registrado nada. En cuanto anotes tu primera venta o tu primer fiado, " +
        "aquí te resumimos cómo va tu negocio.",
      recommendations: [],
    };
  }

  const recs: string[] = [];

  // ── 1 · QUE NO PIERDA LO QUE YA PRESTÓ ────────────────────────────
  if (f.clients.critical > 0) {
    recs.push(
      `Empieza por ${losCuantos(f.clients.critical, "el cliente", "los N clientes")} en estado ` +
        `crítico: ${f.clients.critical === 1 ? "lleva" : "llevan"} más de 30 días sin abonar.`,
    );
  } else if (f.clients.overdue > 0) {
    recs.push(
      `${f.clients.overdue === 1 ? "Avísale" : "Avísales"} por WhatsApp a ` +
        `${losCuantos(f.clients.overdue, "el cliente", "los N clientes")} con el plazo vencido.`,
    );
  }
  if (f.clients.flagged > 0 && recs.length < 3) {
    recs.push(
      `Acuerda un nuevo compromiso de pago con ` +
        `${losCuantos(f.clients.flagged, "el cliente", "los N clientes")} que marcaste como mala paga.`,
    );
  }

  // ── 2 · QUE NO SE LE PARE LA CAJA ─────────────────────────────────
  if (f.stock.bestSellersRunningLow > 0 && recs.length < 3) {
    recs.push(
      `Repón ${losCuantos(f.stock.bestSellersRunningLow, "el producto", "los N productos")} más ` +
        `${f.stock.bestSellersRunningLow === 1 ? "vendido que está" : "vendidos que están"} por agotarse.`,
    );
  } else if (f.stock.outOfStock > 0 && recs.length < 3) {
    recs.push(
      `Revisa ${losCuantos(f.stock.outOfStock, "la referencia agotada", "las N referencias agotadas")} ` +
        `de tu catálogo.`,
    );
  }

  // ── 3 · QUE VENDA MÁS ─────────────────────────────────────────────
  if (f.unhandledOrders > 0 && recs.length < 3) {
    recs.push(
      `Registra ${losCuantos(f.unhandledOrders, "el pedido", "los N pedidos")} del catálogo que ` +
        `${f.unhandledOrders === 1 ? "sigue" : "siguen"} sin atender.`,
    );
  }

  // ── 4 · QUE NO PIERDA CLIENTES BUENOS ─────────────────────────────
  if (f.dormantGoodPayers > 0 && recs.length < 3) {
    recs.push(
      f.dormantGoodPayers === 1
        ? `Uno de tus mejores pagadores lleva más de 30 días sin comprarte: escríbele.`
        : `${f.dormantGoodPayers} de tus mejores pagadores llevan más de 30 días sin comprarte: escríbeles.`,
    );
  }

  return trimToBudget({ summary: buildSummary(f, recs.length === 0), recommendations: recs.slice(0, 3) });
}

/**
 * The one diagnosis sentence, written from the highest-priority finding.
 *
 * `todoEnOrden` is not "nothing to say": the owner chose on 2026-10-29 that
 * when nothing is wrong the assistant *«habla igual, pero de lo bueno»*. A
 * banner that only appears with bad news stops being read as information and
 * starts being read as an alarm.
 */
function buildSummary(f: FactsForTheModel, todoEnOrden: boolean): string {
  const porCobrar = dinero(f.receivable);

  if (todoEnOrden) {
    const cobrado = dinero(suma(f.collectedCash, f.collectedOnDebt));
    return cobrado
      ? `Vas al día: en los últimos ${f.windowDays} días cobraste ${cobrado} y no tienes ` +
          `clientes en estado crítico${porCobrar ? `. Por cobrar te quedan ${porCobrar}` : ""}.`
      : `Vas al día: no tienes clientes en estado crítico ni pedidos sin atender.`;
  }

  const partes: string[] = [];
  if (porCobrar) partes.push(`Tienes ${porCobrar} por cobrar`);
  if (f.clients.critical > 0) {
    partes.push(`${cuantos(f.clients.critical, "cliente lleva", "clientes llevan")} más de 30 días sin abonar`);
  } else if (f.clients.overdue > 0) {
    partes.push(`${cuantos(f.clients.overdue, "cliente tiene", "clientes tienen")} el plazo vencido`);
  }
  if (prestoMasDeLoQueCobro(f)) {
    partes.push(`en estos ${f.windowDays} días fiaste más de lo que cobraste`);
  }
  if (!partes.length) partes.push(`tu negocio se mantiene estable`);

  const frase = `${enumerar(partes)}.`;
  // THE CONFIDENCE CAVEAT, never a recommendation -- see the header.
  return f.gaps.productsWithoutCost > 0
    ? `${frase} Ojo: ${cuantos(f.gaps.productsWithoutCost, "producto no tiene", "productos no tienen")} ` +
        `costo anotado, así que el margen que ves es parcial.`
    : frase;
}
