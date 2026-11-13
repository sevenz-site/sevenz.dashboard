import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { templateSafe } from "@/lib/security/device-text";

// WHAT THE MONDAY AND THURSDAY MESSAGES SAY, AND WHICH ONE GOES. Pure: no database, no
// network, so `qa:negocio-semanal` can feed it every edge without sending anything.
//
// The spec is `../docs/WHATSAPP-PLANTILLAS.md`, «La familia del negocio». The rules that
// shape the text are the owner's, all in CLAUDE.md:
//   - «Las plantillas dicen cada cifra por moneda» (2026-11-06): every count sits next to its
//     own currency, «3 clientes por $120,00 y 1 cliente por €30,00». Never one total count
//     next to two amounts. A currency at zero is not written.
//   - «Un tendero recibe dos mensajes a la semana» (2026-11-06): one template per slot, two
//     slots a week per PHONE, and the Thursday one never stays quiet if someone owes.
//   - And his four answers of 2026-11-13, written in migration 205: both currencies, the whole
//     book balance, «por vencer» only within 7 days.
//
// The bullets, the full stops and the fixed wording live in the approved template; what
// travels here is only the variable part, so none of it ends in a full stop.

export type Ledger = "COP" | "USD" | "EUR";

export type LedgerFigures = {
  due: number;
  overdue_count: number;
  overdue_amount: number;
  soon_count: number;
  soon_amount: number;
};

/** One row of `whatsapp_business_weekly_targets` (migration 205). */
export type WeeklyTarget = {
  owner_id: string;
  whatsapp: string;
  first_name: string | null;
  business_name: string | null;
  country: string | null;
  paused: boolean;
  is_test: boolean;
  ledgers: Partial<Record<Ledger, LedgerFigures>>;
  overdue_clients: number;
  sales: Partial<Record<Ledger, { count: number; amount: number }>>;
  out_of_stock: number;
  low_stock: number;
  open_orders: number;
  // Null when last Thursday nothing went out: there is nothing to compare against.
  new_overdue_clients: number | null;
  monday_used: boolean;
  thursday_used: boolean;
  phone_slots_used: number;
};

export type Parametro = { nombre: string; texto: string };

export type Plan =
  | { template: string; params: Parametro[] }
  | { skip: SkipReason };

export type SkipReason =
  | "cita_usada"
  | "tope_telefono"
  | "pausado"
  | "cuenta_de_prueba"
  | "sin_cobros";

// Two slots a week, counted by phone (CLAUDE.md, point 4). `prueba_por_vencer` and the
// security notices do not count and do not go through here.
export const PHONE_WEEKLY_CAP = 2;

// THE TEMPLATE AND THE NAME OF ITS OWNER PARAMETER, TOGETHER. `cartera_summary_v2` calls it
// `customer_name` -- Kapso's first proposal, kept when the v1 was approved -- and everything
// after calls it `owner_name`. Kapso sends parameters by name and Meta rejects the whole
// message on an unknown one, so the name is part of choosing the template, not a detail.
export const TEMPLATES = {
  businessSummary: "negocio_resumen",
  legacySummary: "cartera_summary_v2",
  paused: "cartera_pausada",
  attentionDebts: "atencion_cobros",
  attentionBusiness: "atencion_negocio",
} as const;

/** The books a business keeps, in the order they are written: dollars before euros. */
export function ledgersOf(country: string | null): Ledger[] {
  return country === "VE" ? ["USD", "EUR"] : ["COP"];
}

export function money(amount: number, ledger: Ledger): string {
  return ledger === "COP" ? formatCurrency(amount) : formatDisplayCurrency(amount, ledger);
}

/** «1 cliente», «3 clientes». */
export function countOf(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// «3 clientes por $120,00 y 1 cliente por €30,00», or «0 clientes» when every book is empty.
// Never an empty string: Meta rejects an empty parameter, and the whole message with it.
function perLedger(
  t: WeeklyTarget,
  pick: (l: Ledger) => { count: number; amount: number } | null,
  singular: string,
  plural: string,
): string {
  const parts: string[] = [];
  for (const l of ledgersOf(t.country)) {
    const v = pick(l);
    if (!v || v.count <= 0) continue;
    parts.push(`${countOf(v.count, singular, plural)} por ${money(v.amount, l)}`);
  }
  return parts.length ? parts.join(" y ") : `0 ${plural}`;
}

/** «Por cobrar: …». Each book on its own, «$50,00 y €20,00»; adding them would invent a figure. */
export function amountDue(t: WeeklyTarget): string {
  const parts = ledgersOf(t.country)
    .filter((l) => Number(t.ledgers[l]?.due ?? 0) > 0)
    .map((l) => money(Number(t.ledgers[l]!.due), l));
  // «$0,00» tells the truth and Meta does not take an empty parameter.
  return parts.length ? parts.join(" y ") : money(0, ledgersOf(t.country)[0]);
}

export function hasDebt(t: WeeklyTarget): boolean {
  return ledgersOf(t.country).some((l) => Number(t.ledgers[l]?.due ?? 0) > 0);
}

export function overdueSummary(t: WeeklyTarget, withNew: boolean): string {
  const base = perLedger(
    t,
    (l) => {
      const f = t.ledgers[l];
      return f ? { count: Number(f.overdue_count), amount: Number(f.overdue_amount) } : null;
    },
    "cliente",
    "clientes",
  );
  // THURSDAY ONLY, and only when last Thursday went out: «nuevo» needs something to be new
  // against. A client is new if they are overdue now and were not on last week's list.
  const n = Number(t.new_overdue_clients ?? 0);
  if (!withNew || t.new_overdue_clients == null || n <= 0) return base;
  return `${base} (${countOf(n, "cliente nuevo", "clientes nuevos")} esta semana)`;
}

export function dueSoonSummary(t: WeeklyTarget): string {
  return perLedger(
    t,
    (l) => {
      const f = t.ledgers[l];
      return f ? { count: Number(f.soon_count), amount: Number(f.soon_amount) } : null;
    },
    "cliente",
    "clientes",
  );
}

// A sale with lines in two currencies counts in both (CLAUDE.md): it is two books.
export function salesSummary(t: WeeklyTarget): string {
  return perLedger(
    t,
    (l) => {
      const s = t.sales[l];
      return s ? { count: Number(s.count), amount: Number(s.amount) } : null;
    },
    "venta",
    "ventas",
  );
}

export function ownerName(t: WeeklyTarget): string {
  return templateSafe(t.first_name?.trim() || t.business_name?.trim() || "");
}

/**
 * Monday. `sentOnPhone` is what this same run already sent to that number: the database
 * count is read once at the start and does not see the run's own sends.
 */
export function mondayPlan(t: WeeklyTarget, sentOnPhone = 0): Plan {
  if (t.monday_used) return { skip: "cita_usada" };
  if (t.phone_slots_used + sentOnPhone >= PHONE_WEEKLY_CAP) return { skip: "tope_telefono" };

  // A row older than the rule that made `first_name` required can have it empty. «hola» is
  // the greeting these messages always fell back to, and it beats both skipping the Monday
  // and «Hola , este es…».
  const name = ownerName(t) || "hola";

  // THE PAUSED OWNER GETS `cartera_pausada` AND NOTHING ELSE, on Monday and on Thursday.
  // Unchanged from 072, with the owner's 2026-10-31 decision behind it («Cada semana, sin
  // fin»): an expired trial that accepted the notices hears from Sevenz every Monday, even
  // with «Por cobrar: $0,00». The 4-week cap is the first thing to reopen if Meta's bill or
  // the number's quality rating moves.
  if (t.paused) {
    return {
      template: TEMPLATES.paused,
      params: [
        { nombre: "owner_name", texto: name },
        { nombre: "amount_due", texto: amountDue(t) },
        { nombre: "overdue_clients", texto: String(t.overdue_clients) },
      ],
    };
  }

  // `negocio_resumen` needs something owed: its first line is «Por cobrar». A real account
  // only (the spec's «cuenta real, no de prueba»).
  if (!t.is_test && hasDebt(t)) {
    return {
      template: TEMPLATES.businessSummary,
      params: [
        { nombre: "owner_name", texto: name },
        { nombre: "amount_due", texto: amountDue(t) },
        { nombre: "overdue_summary", texto: overdueSummary(t, false) },
        { nombre: "sales_summary", texto: salesSummary(t) },
      ],
    };
  }

  // NOTHING OWED, OR A TEST ACCOUNT: the Monday message it got before the family, unchanged.
  // OWNER'S DECISION OF 2026-11-12 (MS-51, point 1): whoever has nothing to collect keeps
  // getting `cartera_summary_v2`, with «$0,00», until `negocio_estado` and `primera_semana`
  // are approved. That is why the Monday slot also counts the old template: both families
  // share the day.
  return {
    template: TEMPLATES.legacySummary,
    params: [
      { nombre: "customer_name", texto: name },
      { nombre: "amount_due", texto: amountDue(t) },
      { nombre: "overdue_clients", texto: String(t.overdue_clients) },
    ],
  };
}

/** Thursday. Same `sentOnPhone` as Monday. */
export function thursdayPlan(t: WeeklyTarget, sentOnPhone = 0): Plan {
  // The paused owner already got `cartera_pausada`, which stands for both days.
  if (t.paused) return { skip: "pausado" };
  // `cartera_attention` used to reach test accounts too. The family is for real accounts
  // only, and there is no older Thursday template left to fall back on.
  if (t.is_test) return { skip: "cuenta_de_prueba" };
  if (t.thursday_used) return { skip: "cita_usada" };

  const books = ledgersOf(t.country).map((l) => t.ledgers[l]);
  const debts = books.some((f) => f && (Number(f.overdue_count) > 0 || Number(f.soon_count) > 0));
  // «Con deudores, el jueves sale siempre» (owner, 2026-11-06). Without them, products and
  // orders alone would need `atencion_productos`, which is not approved: nothing goes out.
  if (!debts) return { skip: "sin_cobros" };

  if (t.phone_slots_used + sentOnPhone >= PHONE_WEEKLY_CAP) return { skip: "tope_telefono" };

  const name = ownerName(t) || "hola";

  const common = [
    { nombre: "owner_name", texto: name },
    { nombre: "overdue_summary", texto: overdueSummary(t, true) },
    { nombre: "due_summary", texto: dueSoonSummary(t) },
  ];

  if (t.out_of_stock + t.low_stock + t.open_orders > 0) {
    return {
      template: TEMPLATES.attentionBusiness,
      params: [
        ...common,
        { nombre: "out_of_stock", texto: String(t.out_of_stock) },
        { nombre: "low_stock", texto: String(t.low_stock) },
        { nombre: "open_orders", texto: String(t.open_orders) },
      ],
    };
  }
  return { template: TEMPLATES.attentionDebts, params: common };
}
