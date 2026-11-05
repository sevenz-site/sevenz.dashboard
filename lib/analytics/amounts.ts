import type { EntryPoint, FlowContext, Money, PaymentForm } from "./events";

// The pure half of the transaction events: no database, no request, so
// `qa/eventos-montos.mjs` can run every case without a server.

// Half a cent, the same tolerance the money actions use.
const TOLERANCE = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

// A Colombian book is `null` in `movements` and `'COP'` in `sale_lines`. Both
// have to land on the same key, or a Colombian sale reports its total in one
// property and its debt in another.
const currencyKey = (currency: string | null | undefined) => (currency ?? "COP").toLowerCase();

// One property per currency, never a sum across them. USD, EUR and COP are always
// present, at zero if need be, so a Mixpanel average over `total_usd` does not
// quietly skip the sales that had none.
export function moneyProps<P extends string>(
  prefix: P,
  amounts: Iterable<readonly [string | null | undefined, number]>,
): Money<P> {
  const out: Record<string, number> = {
    [`${prefix}_usd`]: 0,
    [`${prefix}_eur`]: 0,
    [`${prefix}_cop`]: 0,
  };
  for (const [currency, amount] of amounts) {
    const key = `${prefix}_${currencyKey(currency)}`;
    out[key] = round2((out[key] ?? 0) + amount);
  }
  return out as Money<P>;
}

// HOW A SALE WAS PAID, one word for the whole sale. Each currency is judged on
// its own and the sale takes the word they share, or `mixed` when they differ:
// ten dollars collected and thirty euros on credit is neither cash nor a fiado.
//
// `saldo` IS ITS OWN WORD and is the reason `owed` arrives net of the credit
// used. A sale covered by the client's saldo a favor leaves a charge in the
// ledger, so reading it as `fiado` would count a loan that nobody made. That is
// `CT-166`, the difference between Reportes and the Excel.
export function paymentForm(input: {
  totals: ReadonlyMap<string, number>;
  collected: ReadonlyMap<string, number>;
  owed: ReadonlyMap<string, number>;
}): PaymentForm {
  const forms = new Set<Exclude<PaymentForm, "mixed">>();
  for (const currency of input.totals.keys()) {
    const collected = input.collected.get(currency) ?? 0;
    const owed = input.owed.get(currency) ?? 0;
    const total = input.totals.get(currency) ?? 0;
    if (owed > TOLERANCE) forms.add(collected > TOLERANCE ? "partial" : "fiado");
    else if (total - collected > TOLERANCE) forms.add("saldo");
    else forms.add("cash");
  }
  if (forms.size === 1) return [...forms][0];
  return forms.size === 0 ? "cash" : "mixed";
}

// WHETHER A PAYMENT LEFT THE CLIENT OWING NOTHING in the books it touched: the
// moment a shopkeeper stops chasing somebody, which `lines` alone cannot show.
export function settlesDebt(
  open: readonly { currency?: string | null; pending?: number | string | null }[],
  paid: ReadonlyMap<string | null, number>,
): boolean {
  for (const [book, amount] of paid) {
    const owed = open
      .filter((o) => currencyKey(o.currency) === currencyKey(book))
      .reduce((sum, o) => sum + Number(o.pending ?? 0), 0);
    if (owed - amount > TOLERANCE) return false;
  }
  return paid.size > 0;
}

const ENTRY_POINTS: readonly EntryPoint[] = [
  "register",
  "client_profile",
  "new_client",
  "payment_no_fiados",
  "transaction_detail",
  "report",
  "sale_step_client",
  "order_step_client",
];

export type FlowInput = { flowId?: unknown; entryPoint?: unknown };

// These two arrive from the browser, so neither is trusted: anything that is not
// the expected shape is dropped rather than copied into Mixpanel. A bad value
// costs a property, never the sale it rides on.
export function flowContext(input: FlowInput | undefined): FlowContext {
  const flowId = input?.flowId;
  const entryPoint = input?.entryPoint;
  return {
    ...(typeof flowId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(flowId) ? { flow_id: flowId } : {}),
    ...(ENTRY_POINTS.includes(entryPoint as EntryPoint) ? { entry_point: entryPoint as EntryPoint } : {}),
  };
}
