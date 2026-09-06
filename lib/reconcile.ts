import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";

export type ReviewRow = ExtractedMovement & {
  rowId: string;
  matched_client_id: string | null;
  computed_balance: number;
  needs_review: boolean;
  // True when there's no existing client on file with a document_id for
  // this row — either it's a brand-new client, or it matched an existing
  // one that's never had a cédula/documento recorded. False (no need to
  // ask again) when the matched client already has one.
  needs_document_id: boolean;
};

const RECONCILE_TOLERANCE = 1;

export type ReconcileClient = {
  id: string;
  name: string;
  // The currency-less COP balance. Meaningful for a CO owner; for a VE owner
  // the two below are the real ones.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  document_id: string | null;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// The running balance is per client AND per currency, never per client alone.
//
// A VE owner's $50 and €20 are two independent debts, not one debt seen two
// ways — the rule the whole app follows. One accumulator per client would add
// them together, and the damage would be silent: "Saldo calculado" would show
// a plausible number, and the read_balance comparison below would raise
// "Revisar" on rows that are fine while passing rows that are not. A broken
// check that looks like a working one is worse than no check.
function balanceKey(name: string, currency: LedgerCurrency | null): string {
  return `${normalizeName(name)}|${currency ?? "COP"}`;
}

function seedBalance(client: ReconcileClient, currency: LedgerCurrency | null): number {
  if (currency === "USD") return client.balance_usd;
  if (currency === "EUR") return client.balance_eur;
  return client.balance;
}

export function reconcileMovements(
  extracted: ExtractedMovement[],
  existingClients: ReconcileClient[],
): ReviewRow[] {
  const byName = new Map(existingClients.map((c) => [normalizeName(c.name), c]));
  // Seeded lazily on first use rather than pre-filled, so a client only gets a
  // starting balance for the currencies their rows actually mention.
  const runningBalances = new Map<string, number>();

  return extracted.map((movement, index) => {
    const nameKey = normalizeName(movement.client_name);
    const matched = byName.get(nameKey);
    const key = balanceKey(movement.client_name, movement.currency);
    const prevBalance =
      runningBalances.get(key) ?? (matched ? seedBalance(matched, movement.currency) : 0);
    const delta = movement.type === "charge" ? movement.amount : -movement.amount;
    const computedBalance = prevBalance + delta;
    runningBalances.set(key, computedBalance);

    const reconciles =
      movement.read_balance !== null &&
      Math.abs(movement.read_balance - computedBalance) <= RECONCILE_TOLERANCE;

    return {
      ...movement,
      // Deliberately not keyed on currency: changing the select would change
      // the rowId, React would treat it as a different row, and the inputs
      // would remount and lose focus mid-edit.
      rowId: `${index}-${nameKey}`,
      matched_client_id: matched?.id ?? null,
      computed_balance: computedBalance,
      needs_review: movement.confidence === "low" || movement.read_balance === null || !reconciles,
      needs_document_id: !matched?.document_id,
    };
  });
}
