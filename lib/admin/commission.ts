// THE ARITHMETIC OF A KAM'S COMMISSION, and the only place it exists.
//
// Migration 198 stores the agreement and hands back raw rows; everything that
// counts charges or shares lives here, so the screen, the dialog's live total and
// `qa:kam` run the same code. Writing it again in SQL for one side is the trap of
// `CT-124`. Pure and with no server imports, so a client component can use it.
//
// THE OWNER'S DECISIONS, 2026-11-07: 50% of the charge, on EVERY charge of the
// period, 6 months by default, and only on what the business really paid. With no
// agreed price the proposal comes from the catalogue's Pro price, because a Free
// account in trial would otherwise propose $0 and read as a real agreement.
//
// DATES ARE `YYYY-MM-DD` STRINGS on the business's calendar, already converted by
// the database. Never `new Date()` on them in local time: the app runs in UTC and
// the business does not, and a day off is a charge more or less.

export type Periodicity = "mensual" | "trimestral" | "anual";

export const DEFAULT_SHARE = 0.5;
export const DEFAULT_TERM_MONTHS = 6;

const MONTHS_PER_CHARGE: Record<Periodicity, number> = { mensual: 1, trimestral: 3, anual: 12 };

export type CommissionRow = {
  id: string;
  kam_id: string;
  kam_name: string;
  starts_on: string;
  ends_on: string;
  closed_on: string | null;
  amount_usd: number;
  base_price_usd: number;
  periodicidad: Periodicity;
  source_demo_ends_on: string | null;
  paid_usd: number;
};

export type AccountPayment = { on: string; amount_usd: number };

const cents = (usd: number) => Math.round(usd * 100);

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Calendar months. The 31st clamps to the last day of a shorter month, so a
// charge on 31 Jan falls on 28 Feb and not on 3 Mar.
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return ymd(year, month, Math.min(d, last));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// The last day that counts: the end of the term, or the day the KAM changed.
export function effectiveEnd(c: Pick<CommissionRow, "ends_on" | "closed_on">): string {
  return c.closed_on && c.closed_on < c.ends_on ? c.closed_on : c.ends_on;
}

// Charges that fall between the two dates, both included. The first falls on the
// start itself, which is why a 6-month term of a yearly plan is one charge and not
// zero: the business pays that year on day one.
export function countCharges(startsOn: string, endsOn: string, periodicity: Periodicity): number {
  if (endsOn < startsOn) return 0;
  const step = MONTHS_PER_CHARGE[periodicity];
  let count = 0;
  while (addMonths(startsOn, count * step) <= endsOn) count += 1;
  return count;
}

export type CommissionFigures = {
  charges: number;
  totalUsd: number;
  generatedUsd: number;
  paidUsd: number;
  pendingUsd: number;
  // Paid beyond what was generated. Its own figure and never a negative pending:
  // a minus sign under «Pendiente» reads as an error, the same trap as the
  // «Por cobrar −$178» of 2026-10-23.
  advanceUsd: number;
};

// A payment generates `payment * amount / base`, so a business that pays three
// months at once generates three, and half a month generates half. Payments
// outside the term generate nothing, and the sum never passes the total.
export function commissionFigures(c: CommissionRow, payments: AccountPayment[]): CommissionFigures {
  const end = effectiveEnd(c);
  const charges = countCharges(c.starts_on, end, c.periodicidad);
  const totalCents = cents(c.amount_usd) * charges;
  const inTermCents = payments
    .filter((p) => p.on >= c.starts_on && p.on <= end)
    .reduce((sum, p) => sum + cents(p.amount_usd), 0);
  const generatedCents = Math.min(totalCents, Math.round((inTermCents * c.amount_usd) / c.base_price_usd));
  const paidCents = cents(c.paid_usd);
  return {
    charges,
    totalUsd: totalCents / 100,
    generatedUsd: generatedCents / 100,
    paidUsd: paidCents / 100,
    pendingUsd: Math.max(0, generatedCents - paidCents) / 100,
    advanceUsd: Math.max(0, paidCents - generatedCents) / 100,
  };
}

export type ProposalInput = {
  today: string;
  demoEndsOn: string | null;
  paidUntilOn: string | null;
  priceUsd: number | null;
  periodicity: Periodicity | null;
  catalogProUsd: number;
  // Where the previous agreement stopped counting. The new one starts after it,
  // or a payment on the shared day would generate commission twice.
  lastEndOn: string | null;
};

export type Proposal = {
  startsOn: string;
  startSource: "demo" | "paid_until" | "today" | "previous_agreement";
  endsOn: string;
  amountUsd: number;
  basePriceUsd: number;
  periodicity: Periodicity;
  baseSource: "agreed" | "catalog";
};

export function proposeCommission(input: ProposalInput): Proposal {
  let startsOn: string;
  let startSource: Proposal["startSource"];
  if (input.demoEndsOn) {
    startsOn = addDays(input.demoEndsOn, 1);
    startSource = "demo";
  } else if (input.paidUntilOn) {
    startsOn = addDays(input.paidUntilOn, 1);
    startSource = "paid_until";
  } else {
    startsOn = input.today;
    startSource = "today";
  }
  if (input.lastEndOn && startsOn <= input.lastEndOn) {
    startsOn = addDays(input.lastEndOn, 1);
    startSource = "previous_agreement";
  }

  const agreed = (input.priceUsd ?? 0) > 0;
  const basePriceUsd = agreed ? (input.priceUsd as number) : input.catalogProUsd;
  return {
    startsOn,
    startSource,
    endsOn: addDays(addMonths(startsOn, DEFAULT_TERM_MONTHS), -1),
    amountUsd: Math.round(basePriceUsd * DEFAULT_SHARE * 100) / 100,
    basePriceUsd,
    // A price with no period has only ever meant a monthly one: the catalogue
    // price is monthly since 173.
    periodicity: agreed && input.periodicity ? input.periodicity : "mensual",
    baseSource: agreed ? "agreed" : "catalog",
  };
}

// Where the last closed agreement stopped counting, ignoring one closed before it
// began: that one never covered any day.
export function lastCoveredDay(commissions: CommissionRow[]): string | null {
  const ends = commissions
    .filter((c) => c.closed_on && c.starts_on <= effectiveEnd(c))
    .map(effectiveEnd)
    .sort();
  return ends.at(-1) ?? null;
}

export type Drift = { kind: "demo"; demoEndsOn: string } | { kind: "price"; priceUsd: number; periodicity: Periodicity };

// What moved since the agreement was saved. The agreement never follows by itself
// (the owner's decision of 2026-11-07): the screen says so and a person decides. A
// demo that is gone is not a drift: the first payment clears it, and that is the
// agreement working as planned.
export function commissionDrift(
  c: CommissionRow,
  account: { demoEndsOn: string | null; priceUsd: number | null; periodicity: Periodicity | null },
): Drift[] {
  if (c.closed_on) return [];
  const drift: Drift[] = [];
  if (account.demoEndsOn && account.demoEndsOn !== c.source_demo_ends_on) {
    drift.push({ kind: "demo", demoEndsOn: account.demoEndsOn });
  }
  const price = account.priceUsd ?? 0;
  if (price > 0) {
    const period = account.periodicity ?? c.periodicidad;
    if (cents(price) !== cents(c.base_price_usd) || period !== c.periodicidad) {
      drift.push({ kind: "price", priceUsd: price, periodicity: period });
    }
  }
  return drift;
}
