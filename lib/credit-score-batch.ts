import { createClient } from "@/lib/supabase/server";
import { computeCreditScore, type CreditScoreResult } from "@/lib/credit-score";
import { combinedBalanceUsd, toCombinedUsd, type EffectiveRate } from "@/lib/exchange-rate/convert";
import type { ClientSummary, Movement } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Shared by the Cartera and Malas pagas tables, which both need a score per
// row for a whole page of clients at once — two `.in("client_id", ...)`
// queries instead of one per client, grouped in JS and fed through the same
// pure computeCreditScore() the client detail page uses for a single client.
//
// effectiveRate is only present for a VE owner. Movements are converted to
// USD before scoring — computeCreditScore's FIFO payment-matching assumes
// every movement is one comparable unit, and a EUR payment could otherwise
// appear to close a USD charge just because it's the oldest unpaid one.
export async function computeCreditScoresForClients(
  supabase: SupabaseServerClient,
  rows: ClientSummary[],
  effectiveRate: EffectiveRate | null = null,
): Promise<Record<string, CreditScoreResult>> {
  const clientIds = rows.map((r) => r.client_id);
  if (clientIds.length === 0) return {};

  const [{ data: movements }, { data: flags }] = await Promise.all([
    supabase
      .from("movements")
      .select("client_id, type, amount, currency, created_at, plazo_dias")
      .in("client_id", clientIds)
      .is("deleted_at", null),
    supabase
      .from("client_flags")
      .select("client_id, unflagged_at")
      .in("client_id", clientIds)
      .not("unflagged_at", "is", null)
      .order("unflagged_at", { ascending: false }),
  ]);

  const movementsByClient = new Map<
    string,
    Pick<Movement, "type" | "amount" | "created_at" | "plazo_dias">[]
  >();
  for (const m of movements ?? []) {
    const list = movementsByClient.get(m.client_id) ?? [];
    list.push(
      effectiveRate ? { ...m, amount: toCombinedUsd(m.amount, m.currency, effectiveRate) } : m,
    );
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
    const balance = effectiveRate
      ? combinedBalanceUsd(row.balance_usd, row.balance_eur, effectiveRate)
      : row.balance;
    scores[row.client_id] = computeCreditScore({
      movements: movementsByClient.get(row.client_id) ?? [],
      balance,
      daysSincePayment: row.days_since_payment,
      oldestUnpaidChargeAt: row.oldest_unpaid_charge_at,
      oldestUnpaidChargePlazoDias: row.oldest_unpaid_charge_plazo_dias,
      isFlagged: row.is_flagged,
      mostRecentUnflaggedAt: lastUnflagByClient.get(row.client_id) ?? null,
    });
  }
  return scores;
}
