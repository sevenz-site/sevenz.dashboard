export type MovementType = "charge" | "payment";
export type MovementSource = "photo_import" | "manual";

export type ExchangeRateMode = "BCV_AUTO" | "CUSTOM";
export type DisplayCurrency = "USD" | "EUR";

// The two currencies a VE owner's debt can be denominated in. Each is its
// own independent ledger: a client can owe $50 and €20 at the same time, and
// a dollar payment only ever reduces the dollar debt.
export type LedgerCurrency = "USD" | "EUR";
export const LEDGER_CURRENCIES: LedgerCurrency[] = ["USD", "EUR"];
export const DEFAULT_LEDGER_CURRENCY: LedgerCurrency = "USD";

export type Movement = {
  id: string;
  client_id: string;
  type: MovementType;
  amount: number;
  description: string | null;
  source: MovementSource;
  running_balance: number;
  needs_review: boolean;
  photo_path: string | null;
  plazo_dias: number | null;
  created_at: string;
  // Which ledger this movement belongs to. null for a country='CO' owner,
  // whose single ledger is COP.
  currency: LedgerCurrency | null;
  // Exchange-rate snapshot: null for every movement recorded by a country
  // = 'CO' owner. official_bcv_rate_at_time is always filled in for a 'VE'
  // owner even when rate_mode_used = 'CUSTOM' — the objective comparison
  // point for a future dispute.
  rate_mode_used: ExchangeRateMode | null;
  exchange_rate_used: number | null;
  official_bcv_rate_at_time: number | null;
  // What the owner actually typed, before conversion (amount is always Bs).
  // entry_currency 'VES' means no conversion happened at all.
  entry_currency: MovementCurrencyCode | null;
  entry_amount: number | null;
  // Both effective rates at write time, so any Bs figure on this movement can
  // be converted to either display currency using the rate that applied then.
  rate_usd_at_time: number | null;
  rate_eur_at_time: number | null;
};

// Mirrors lib/exchange-rate/convert.ts's MovementCurrency — declared here
// too so lib/types.ts stays free of a dependency on that module.
export type MovementCurrencyCode = "VES" | "USD" | "EUR";

// Payment terms selectable on a charge. null ("Sin especificar") means no
// due date — those charges fall back to the old immediate-mora behavior.
export const PLAZO_PAGO_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "7", label: "7 días", days: 7 },
  { value: "15", label: "15 días", days: 15 },
  { value: "30", label: "30 días", days: 30 },
  { value: "45", label: "45 días", days: 45 },
  { value: "sin_especificar", label: "Sin especificar", days: null },
];
export const DEFAULT_PLAZO_PAGO = "7";

export type OwnerPlan = "free" | "pro";
// Gates the exchange-rate feature end to end: only 'VE' owners see any of
// the Bs/BCV UI. 'CO' is the default — every existing owner is unaffected.
export type OwnerCountry = "CO" | "VE";

export type Owner = {
  id: string;
  email: string;
  business_name: string;
  first_name: string | null;
  last_name: string | null;
  whatsapp: string | null;
  address: string | null;
  tax_id: string | null;
  logo_path: string | null;
  plan: OwnerPlan;
  payment_info: string | null;
  country: OwnerCountry;
  onboarding_completed_at: string | null;
  created_at: string;
};

// No row = implicit BCV_AUTO + USD (the settings screen only upserts once
// the owner actually saves).
export type OwnerExchangeSettings = {
  owner_id: string;
  rate_mode: ExchangeRateMode;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
  custom_rate_set_at: string | null;
  display_currency: DisplayCurrency;
  updated_at: string;
};

export type BcvRate = {
  usd: number;
  eur: number;
  source: string;
  fetched_at: string;
};

export type Client = {
  id: string;
  owner_id: string;
  name: string;
  whatsapp: string | null;
  address: string | null;
  document_id: string | null;
  created_at: string;
  is_flagged: boolean;
};

export type ClientSummary = {
  client_id: string;
  owner_id: string;
  name: string;
  whatsapp: string | null;
  document_id: string | null;
  client_created_at: string;
  // The COP ledger (country='CO'). A VE owner's debt lives in the two
  // per-currency balances below instead.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  has_pending_review: boolean;
  last_payment_at: string | null;
  mora_reference_at: string;
  days_since_payment: number;
  oldest_unpaid_charge_at: string | null;
  oldest_unpaid_charge_plazo_dias: number | null;
  is_flagged: boolean;
};

export type ClientFlag = {
  id: string;
  client_id: string;
  owner_id: string;
  reason: string;
  flagged_at: string;
  unflagged_at: string | null;
};

export type ClientStatus =
  | "sin_deuda"
  | "a_favor"
  | "dentro_del_plazo"
  | "plazo_vencido"
  | "sin_plazo"
  | "critico";

const CRITICO_THRESHOLD_DAYS = 30;

// Status reflects the balance first (does the client owe, or are they owed?).
// While there IS a debt: if the oldest unpaid charge has a plazo (payment
// term) and it hasn't expired yet, the client is simply "dentro_del_plazo" —
// not late. Once that term expires it's "plazo_vencido"; if that charge never
// had a term at all it's "sin_plazo" — same severity, different reason, so
// callers can tell them apart. Either way it still escalates to "critico"
// after CRITICO_THRESHOLD_DAYS since the last payment.
export function getClientStatus(
  balance: number,
  daysSincePayment: number,
  oldestUnpaidChargeAt: string | null = null,
  oldestUnpaidChargePlazoDias: number | null = null,
): ClientStatus {
  if (balance === 0) return "sin_deuda";
  if (balance < 0) return "a_favor";

  const hasPlazo = oldestUnpaidChargeAt !== null && oldestUnpaidChargePlazoDias !== null;
  if (hasPlazo) {
    const daysSinceCharge = Math.floor(
      (Date.now() - new Date(oldestUnpaidChargeAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceCharge <= oldestUnpaidChargePlazoDias) return "dentro_del_plazo";
  }

  if (daysSincePayment > CRITICO_THRESHOLD_DAYS) return "critico";
  return hasPlazo ? "plazo_vencido" : "sin_plazo";
}

// Label for the balance figure itself (distinct from ClientStatus, which
// only applies when there's a debt) — "Debe" only makes sense when the
// client actually owes money.
export function getBalanceLabel(balance: number): string {
  if (balance > 0) return "Debe";
  if (balance < 0) return "A favor";
  return "Sin deuda";
}

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  sin_deuda: "Sin deuda",
  a_favor: "A favor",
  dentro_del_plazo: "Dentro del plazo",
  plazo_vencido: "Plazo vencido",
  sin_plazo: "Sin plazo",
  critico: "Crítico",
};

export const CLIENT_STATUS_DESCRIPTION: Record<ClientStatus, string> = {
  sin_deuda: "No debe nada",
  a_favor: "Pagó de más",
  dentro_del_plazo: "Debe, pero aún no vence su plazo",
  plazo_vencido: "Debe, y ya venció el plazo que se le dio",
  sin_plazo: "Debe, y nunca se le puso plazo",
  critico: "Debe hace más de 30 días sin abonar",
};

export const CLIENT_STATUS_BADGE_CLASS: Record<ClientStatus, string> = {
  // text-foreground (not text-muted-foreground) — on bg-muted,
  // muted-foreground only clears ~4.35:1 contrast, just under WCAG AA's
  // 4.5:1 for this text size.
  sin_deuda: "bg-muted text-foreground border-transparent",
  a_favor:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  dentro_del_plazo:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  plazo_vencido:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  sin_plazo:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  critico:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
};

// Deliberately not part of CLIENT_STATUS_BADGE_CLASS's palette — "Mala paga"
// is the owner's own judgment call, not a computed payment-status signal, so
// it always shows as a second badge alongside the status one, styled to read
// as a different kind of thing (a "blacklist" mark, not a severity level).
export const MALA_PAGA_BADGE_CLASS = "border-transparent bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";

// Keyed by the tier label computeCreditScore() returns (lib/credit-score.ts)
// — kept here alongside the other badge-class maps rather than in that pure
// module, consistent with how CLIENT_STATUS_BADGE_CLASS lives here too.
export const CREDIT_SCORE_TIER_BADGE_CLASS: Record<string, string> = {
  Excelente:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  Bueno: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  Regular:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  Malo: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  "Sin historial": "bg-muted text-foreground border-transparent",
};

export type ExtractedMovement = {
  client_name: string;
  date: string | null;
  type: MovementType;
  amount: number;
  description: string | null;
  read_balance: number | null;
  confidence: "high" | "low";
};
