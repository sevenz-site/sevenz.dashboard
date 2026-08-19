import type { ExtractedMovement } from "@/lib/types";

export type ReviewRow = ExtractedMovement & {
  rowId: string;
  matched_client_id: string | null;
  computed_balance: number;
  needs_review: boolean;
};

const RECONCILE_TOLERANCE = 1;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function reconcileMovements(
  extracted: ExtractedMovement[],
  existingClients: { id: string; name: string; balance: number }[],
): ReviewRow[] {
  const byName = new Map(existingClients.map((c) => [normalizeName(c.name), c]));
  const runningBalances = new Map<string, number>();
  for (const c of existingClients) {
    runningBalances.set(normalizeName(c.name), c.balance);
  }

  return extracted.map((movement, index) => {
    const key = normalizeName(movement.client_name);
    const matched = byName.get(key);
    const prevBalance = runningBalances.get(key) ?? 0;
    const delta = movement.type === "charge" ? movement.amount : -movement.amount;
    const computedBalance = prevBalance + delta;
    runningBalances.set(key, computedBalance);

    const reconciles =
      movement.read_balance !== null &&
      Math.abs(movement.read_balance - computedBalance) <= RECONCILE_TOLERANCE;

    return {
      ...movement,
      rowId: `${index}-${key}`,
      matched_client_id: matched?.id ?? null,
      computed_balance: computedBalance,
      needs_review: movement.confidence === "low" || movement.read_balance === null || !reconciles,
    };
  });
}
