import { createClient } from "@/lib/supabase/server";
import { computeCreditScore, type CreditScoreResult } from "@/lib/credit-score";
import type { ClientSummary, Movement } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Shared by the Cartera and Malas pagas tables, which both need a score per
// row for a whole page of clients at once — two `.in("client_id", ...)`
// queries instead of one per client, grouped in JS and fed through the same
// pure computeCreditScore() the client detail page uses for a single client.
export async function computeCreditScoresForClients(
  supabase: SupabaseServerClient,
  rows: ClientSummary[],
): Promise<Record<string, CreditScoreResult>> {
  const clientIds = rows.map((r) => r.client_id);
  if (clientIds.length === 0) return {};

  const [{ data: movements }, { data: flags }] = await Promise.all([
    supabase
      .from("movements")
      .select("client_id, type, amount, created_at, plazo_dias")
      .in("client_id", clientIds)
      .is("deleted_at", null),
    supabase
      .from("client_flags")
      .select("client_id, unflagged_at")
      .in("client_id", clientIds)
      .not("unflagged_at", "is", null)
      .order("unflagged_at", { ascending: false }),
  ]);

  const movementsByClient = new Map<string, Pick<Movement, "type" | "amount" | "created_at" | "plazo_dias">[]>();
  for (const m of movements ?? []) {
    const list = movementsByClient.get(m.client_id) ?? [];
    list.push(m);
    movementsByClient.set(m.client_id, list);
  }

  // Ordered by unflagged_at desc, so the first row seen per client is its
  // most recent unflag.
  const lastUnflagByClient = new Map<string, string>();
  for (const f of flags ?? []) {
    if (f.unflagged_at && !lastUnflagByClient.has(f.client_id)) {
      lastUnflagByClient.set(f.client_id, f.unflagged_at);
    }
  }

  const scores: Record<string, CreditScoreResult> = {};
  for (const row of rows) {
    scores[row.client_id] = computeCreditScore({
      movements: movementsByClient.get(row.client_id) ?? [],
      balance: row.balance,
      daysSincePayment: row.days_since_payment,
      oldestUnpaidChargeAt: row.oldest_unpaid_charge_at,
      oldestUnpaidChargePlazoDias: row.oldest_unpaid_charge_plazo_dias,
      isFlagged: row.is_flagged,
      mostRecentUnflaggedAt: lastUnflagByClient.get(row.client_id) ?? null,
    });
  }
  return scores;
}
