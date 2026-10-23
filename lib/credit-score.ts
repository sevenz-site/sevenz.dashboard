import {
  getClientStatus,
  CLIENT_STATUS_LABEL,
  type ClientStatus,
  type LedgerCurrency,
  type Movement,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Charges left "sin especificar" (no plazo_dias) still get judged, just
// against this default grace window instead of an owner-chosen term.
const DEFAULT_GRACE_DAYS = 30;

// "Recent" window for the trend component — old history still counts (via
// the lifetime component) but matters less as it ages out of this window.
const RECENT_WINDOW_DAYS = 180;

// Bayesian shrinkage toward a neutral prior so a client with 1 data point
// doesn't score as confidently as one with 20 — see lib/credit-score.ts's
// rate() below.
const SHRINKAGE_K = 5;
const SHRINKAGE_PRIOR = 0.7;

const WEIGHT_LIFETIME = 0.35;
const WEIGHT_STANDING = 0.3;
const WEIGHT_RECENT = 0.2;
const WEIGHT_TENURE = 0.15;

const TENURE_MONTHS_CAP = 12;
const TENURE_CYCLES_CAP = 10;

const FLAG_ACTIVE_CAP = 400;
const FLAG_DECAY_DAYS = 180;
const FLAG_DECAY_MAX_PENALTY = 100;

const NO_HISTORY_SCORE = 500;

const STANDING_SCORE: Record<ClientStatus, number> = {
  sin_deuda: 100,
  a_favor: 100,
  dentro_del_plazo: 90,
  plazo_vencido: 50,
  sin_plazo: 50,
  critico: 15,
};

export type CreditScoreBreakdownLine = { label: string; detail: string };

export type CreditScoreResult = {
  score: number;
  tier: string;
  breakdown: CreditScoreBreakdownLine[];
};

// `id`, `currency` and `applies_to_movement_id` joined this list on 2026-10-23
// (`CT-124`): without them the walk below cannot reproduce what the database
// does, and every caller that leaves one out silently gets the old answer.
type MovementInput = Pick<
  Movement,
  "id" | "type" | "amount" | "currency" | "created_at" | "plazo_dias" | "applies_to_movement_id"
>;

export type ChargeLedgerEntry = {
  movementId: string;
  currency: LedgerCurrency | null;
  createdAt: string;
  plazoDias: number | null;
  remaining: number;
  closedAt: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// One ledger per currency, with NULL as a ledger of its own.
//
// Mirrors `currency is not distinct from cur.currency` in the database: for a
// Colombian business NULL is a real ledger, not "no currency". The sentinel is
// a string no `LedgerCurrency` can be: the type is "USD" | "EUR".
const NULL_LEDGER = "SIN_MONEDA";

// HOW A PAYMENT IS SPREAD OVER THE CHARGES — the same rule the database runs.
//
// This is the second copy of one rule, and that is a known cost, taken on
// deliberately: the first lives in `get_open_charges_for_client` (migration
// `126`) and the punctuality factor below needs something that function does
// not return — WHEN each charge was closed, not just which ones are still
// open. Moving the whole walk into SQL is the other answer and a much larger
// one; it is written down in `CT-124`.
//
// WHAT KEEPS THE TWO COPIES HONEST is `qa/puntaje-reparte-igual.mjs`
// (`npm run qa:puntaje`): it compares this walk against the database's, fiado
// by fiado, over every dev client that has a directed payment. Change anything
// here and run it. A unit test written against what this function is MEANT to
// do passes while the two halves drift apart -- which is exactly what happened
// for the four days migration `126` was live.
//
// ===========================================================================
// WHAT IT GOT WRONG UNTIL 2026-10-23 (`CT-124`), and both halves mattered
//
//   1. IT IGNORED THE DIRECTION. Migration `126` taught the database to honour
//      the fiado the shopkeeper picked; this walk kept paying the oldest one.
//      Measured in dev: two $50 fiados, one with 60 days left and one overdue
//      by 23, and a $50 payment aimed at the overdue one. The database said the
//      first was still owed in full; the score said «1 of 2 charges paid on
//      time» -- crediting a punctual payment to a fiado nobody had paid, and
//      forgiving the late one. The score exists to warn about who does not pay,
//      so it was rewarding the client who dodges his oldest debt.
//
//   2. IT KEPT ONE QUEUE FOR ALL CURRENCIES. The database keeps one per
//      currency, so a payment in euros could never close a charge in dollars.
//      Here it could, just by being the oldest unpaid one. The callers worked
//      around it by converting every amount to USD first, which does not
//      separate the ledgers at all -- it only makes the numbers comparable --
//      and introduced a bug of its own: converted amounts carry decimals the
//      database never stores, and this walk rounds at every step, so a 3 EUR
//      fiado paid with three 1 EUR payments ended at 0.01 and NEVER CLOSED.
//      It was then counted as late. Those conversions are gone; each ledger is
//      measured in its own currency, which is exact.
function porLibro(movements: MovementInput[]): Map<string, MovementInput[]> {
  const libros = new Map<string, MovementInput[]>();
  for (const m of movements) {
    const clave = m.currency ?? NULL_LEDGER;
    const lista = libros.get(clave) ?? [];
    lista.push(m);
    libros.set(clave, lista);
  }
  return libros;
}

export function buildChargeLedger(movements: MovementInput[]): ChargeLedgerEntry[] {
  const todos: ChargeLedgerEntry[] = [];

  for (const [, delLibro] of porLibro(movements)) {
    // `created_at asc, id asc`, the database's exact order. THE `id` TIEBREAK
    // IS NOT DECORATION: every line of one split payment shares a
    // `created_at`, because inside a transaction `now()` is the transaction's
    // timestamp. Sorting by date alone leaves their order to however the rows
    // arrived, so the same client could score differently on two page loads.
    const enOrden = [...delLibro].sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (d !== 0) return d;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const charges: ChargeLedgerEntry[] = [];

    for (const m of enOrden) {
      if (m.type === "charge") {
        charges.push({
          movementId: m.id,
          currency: m.currency,
          createdAt: m.created_at,
          plazoDias: m.plazo_dias,
          remaining: m.amount,
          closedAt: null,
        });
        continue;
      }

      // ── THE DIRECTED PAYMENT GOES FIRST ──────────────────────────────
      //
      // Only if the fiado it names is already in this ledger's queue, which is
      // the database's condition too: a target in another currency, or one
      // that is not a charge, is not there, and the payment falls through to
      // the queue below. The excess over what that fiado owed is DROPPED and
      // not passed on to the next -- `greatest(... , 0)` in SQL -- so an
      // over-sized directed payment cannot settle a second fiado here either.
      let dirigido = false;
      if (m.applies_to_movement_id) {
        const destino = charges.find((c) => c.movementId === m.applies_to_movement_id);
        if (destino) {
          destino.remaining = round2(Math.max(destino.remaining - m.amount, 0));
          // Only the FIRST time it reaches zero. A later directed payment onto
          // an already-settled fiado must not move its close date forward and
          // turn a punctual payment into a late one.
          if (destino.remaining <= 0 && destino.closedAt === null) {
            destino.closedAt = m.created_at;
          }
          dirigido = true;
        }
      }
      if (dirigido) continue;

      // ── OTHERWISE, OLDEST FIRST ──────────────────────────────────────
      //
      // Every payment written before migration `126` lands here, which is most
      // of what production holds: none of them carries a direction.
      let resto = m.amount;
      for (const charge of charges) {
        if (resto <= 0) break;
        if (charge.remaining <= 0) continue;
        const aplicado = Math.min(charge.remaining, resto);
        charge.remaining = round2(charge.remaining - aplicado);
        resto = round2(resto - aplicado);
        if (charge.remaining <= 0 && charge.closedAt === null) {
          charge.closedAt = m.created_at;
        }
      }
    }

    todos.push(...charges);
  }

  return todos;
}

type ChargeEval = { onTime: boolean; ageDays: number };

// A charge not yet past its own due date is excluded — there's nothing to
// judge yet. Everything else (closed, or open-and-overdue) counts.
function evaluateCharges(charges: ChargeLedgerEntry[], now: Date): ChargeEval[] {
  const evals: ChargeEval[] = [];

  for (const c of charges) {
    const dueAt = new Date(c.createdAt).getTime() + (c.plazoDias ?? DEFAULT_GRACE_DAYS) * DAY_MS;

    if (c.closedAt) {
      const closedAtMs = new Date(c.closedAt).getTime();
      evals.push({ onTime: closedAtMs <= dueAt, ageDays: (now.getTime() - closedAtMs) / DAY_MS });
    } else if (now.getTime() > dueAt) {
      evals.push({ onTime: false, ageDays: 0 });
    }
  }

  return evals;
}

// Bayesian shrinkage: n * rawRate is just onTimeCount, so this reduces to
// (onTimeCount + K*PRIOR) / (n + K) — pulls small samples toward PRIOR and
// converges to the raw rate as n grows. n = 0 naturally yields PRIOR.
function shrunkRate(evals: ChargeEval[]): { n: number; onTimeCount: number; shrunk: number } {
  const n = evals.length;
  const onTimeCount = evals.filter((e) => e.onTime).length;
  const shrunk = (onTimeCount + SHRINKAGE_K * SHRINKAGE_PRIOR) / (n + SHRINKAGE_K);
  return { n, onTimeCount, shrunk };
}

function tierFor(score: number): string {
  if (score >= 750) return "Excelente";
  if (score >= 550) return "Bueno";
  if (score >= 350) return "Regular";
  return "Malo";
}

export function computeCreditScore(params: {
  movements: MovementInput[];
  balance: number;
  daysSincePayment: number;
  // RENOMBRADOS EN LA `134`, y no es cosmético: ahora llega el fiado MÁS
  // VENCIDO, no el más antiguo. El puntaje usa la MISMA etiqueta que la
  // pantalla —si la de arriba dice «Crítico», el puntaje no puede decir
  // «dentro del plazo» del mismo cliente en la misma ficha—, así que tenía
  // que moverse con ella. Los nombres viejos describían el dato anterior y
  // habrían hecho pasar por antigüedad lo que ahora es gravedad.
  worstChargeAt: string | null;
  worstChargePlazoDias: number | null;
  // Desde la migración `118`. Lo que NO cambia es la puntualidad histórica de
  // más abajo, que sigue juzgando cada fiado contra su plazo entero:
  // convertir cada cuota en un vencimiento multiplicaría los juicios de todo
  // el mundo sin que nadie lo haya pedido.
  //
  // Lo que SÍ cambió el 2026-10-23 (`CT-124`) es cómo esa parte reparte los
  // abonos: ya no por antigüedad, sino como la base — la dirección primero y
  // un libro por moneda.
  worstChargeDueAt: string | null;
  isFlagged: boolean;
  mostRecentUnflaggedAt: string | null;
}): CreditScoreResult {
  const now = new Date();
  const sorted = [...params.movements].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const monthsActive =
    sorted.length > 0 ? (now.getTime() - new Date(sorted[0].created_at).getTime()) / DAY_MS / 30 : 0;

  const charges = buildChargeLedger(sorted);
  const lifetimeEvals = evaluateCharges(charges, now);
  const lifetime = shrunkRate(lifetimeEvals);

  if (lifetime.n === 0) {
    return {
      score: NO_HISTORY_SCORE,
      tier: "Sin historial",
      breakdown: [
        {
          label: "Antigüedad",
          detail:
            sorted.length > 0
              ? `Cliente desde hace ${Math.max(0, Math.round(monthsActive))} meses`
              : "Cliente nuevo, todavía sin transacciones",
        },
        {
          label: "Puntualidad histórica",
          detail: "Aún no hay cargos suficientes para calcular su historial de pago",
        },
      ],
    };
  }

  const recentEvals = lifetimeEvals.filter((e) => e.ageDays <= RECENT_WINDOW_DAYS);
  const recent = shrunkRate(recentEvals);

  const status = getClientStatus({
    balance: params.balance,
    daysSincePayment: params.daysSincePayment,
    worstChargeAt: params.worstChargeAt,
    worstChargePlazoDias: params.worstChargePlazoDias,
    worstChargeDueAt: params.worstChargeDueAt,
  });
  const standingScore = STANDING_SCORE[status];

  const cyclesCompleted = charges.filter((c) => c.closedAt !== null).length;
  const tenureScore =
    100 *
    (0.5 * Math.min(1, monthsActive / TENURE_MONTHS_CAP) + 0.5 * Math.min(1, cyclesCompleted / TENURE_CYCLES_CAP));

  let score =
    1000 *
    (WEIGHT_LIFETIME * lifetime.shrunk +
      WEIGHT_STANDING * (standingScore / 100) +
      WEIGHT_RECENT * recent.shrunk +
      WEIGHT_TENURE * (tenureScore / 100));

  // Kept separate from the weighted blend above on purpose — this is the
  // owner's own judgment call, not a computed signal, same reasoning as the
  // "Mala paga" badge staying visually distinct from the status badge.
  let flagLine: CreditScoreBreakdownLine | null = null;
  if (params.isFlagged) {
    score = Math.min(score, FLAG_ACTIVE_CAP);
    flagLine = { label: "Marca del dueño", detail: "Marcado actualmente como mala paga" };
  } else if (params.mostRecentUnflaggedAt) {
    const daysSinceUnflag = (now.getTime() - new Date(params.mostRecentUnflaggedAt).getTime()) / DAY_MS;
    if (daysSinceUnflag < FLAG_DECAY_DAYS) {
      const penalty = FLAG_DECAY_MAX_PENALTY * (1 - daysSinceUnflag / FLAG_DECAY_DAYS);
      score = Math.max(0, score - penalty);
      flagLine = {
        label: "Marca del dueño",
        detail: `Fue mala paga hace ${Math.max(0, Math.round(daysSinceUnflag))} días (ya se quitó la marca)`,
      };
    }
  }

  score = Math.round(Math.max(0, Math.min(1000, score)));

  const breakdown: CreditScoreBreakdownLine[] = [
    { label: "Puntualidad histórica", detail: `${lifetime.onTimeCount} de ${lifetime.n} cargos pagados a tiempo` },
    { label: "Estado actual", detail: CLIENT_STATUS_LABEL[status] },
  ];
  if (recent.n > 0) {
    breakdown.push({
      label: "Tendencia reciente",
      detail: `Últimos 6 meses: ${recent.onTimeCount} de ${recent.n} a tiempo`,
    });
  }
  breakdown.push({
    label: "Antigüedad",
    detail: `Cliente desde hace ${Math.max(0, Math.round(monthsActive))} meses · ${cyclesCompleted} ciclos completados`,
  });
  if (flagLine) breakdown.push(flagLine);

  return { score, tier: tierFor(score), breakdown };
}
