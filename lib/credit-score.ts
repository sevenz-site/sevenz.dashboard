import { getClientStatus, CLIENT_STATUS_LABEL, type ClientStatus, type Movement } from "@/lib/types";

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

type MovementInput = Pick<Movement, "type" | "amount" | "created_at" | "plazo_dias">;

type ChargeLedgerEntry = {
  createdAt: string;
  plazoDias: number | null;
  remaining: number;
  closedAt: string | null;
};

// FIFO walk, same rule get_oldest_unpaid_charge already applies in SQL
// (oldest charge paid off first), just recording every charge's close date
// instead of only the oldest still-unpaid one.
function buildChargeLedger(sortedMovements: MovementInput[]): ChargeLedgerEntry[] {
  const charges: ChargeLedgerEntry[] = [];

  for (const m of sortedMovements) {
    if (m.type === "charge") {
      charges.push({ createdAt: m.created_at, plazoDias: m.plazo_dias, remaining: m.amount, closedAt: null });
      continue;
    }

    let remainingPayment = m.amount;
    for (const charge of charges) {
      if (remainingPayment <= 0) break;
      if (charge.remaining <= 0) continue;
      const applied = Math.min(charge.remaining, remainingPayment);
      charge.remaining = Math.round((charge.remaining - applied) * 100) / 100;
      remainingPayment = Math.round((remainingPayment - applied) * 100) / 100;
      if (charge.remaining <= 0 && charge.closedAt === null) {
        charge.closedAt = m.created_at;
      }
    }
  }

  return charges;
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
  oldestUnpaidChargeAt: string | null;
  oldestUnpaidChargePlazoDias: number | null;
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
              : "Cliente nuevo, todavía sin movimientos",
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

  const status = getClientStatus(
    params.balance,
    params.daysSincePayment,
    params.oldestUnpaidChargeAt,
    params.oldestUnpaidChargePlazoDias,
  );
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
