import type { createClient } from "@/lib/supabase/server";
import { computeCreditScore, type CreditScoreResult } from "@/lib/credit-score";
import { combinedBalanceUsd, type EffectiveRate } from "@/lib/exchange-rate/convert";
import { readAllByIds } from "@/lib/supabase/read-all";
import type { ClientSummary, Movement } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type ScoredMovement = Pick<
  Movement,
  "id" | "type" | "amount" | "currency" | "created_at" | "plazo_dias" | "applies_to_movement_id"
>;

// Shared by the Cartera and Malas pagas tables, which both need a score per
// row for a whole page of clients at once — two `.in("client_id", ...)`
// queries instead of one per client, grouped in JS and fed through the same
// pure computeCreditScore() the client detail page uses for a single client.
//
// effectiveRate is only present for a VE owner, and it is used for the BALANCE
// only.
//
// MOVEMENTS ARE NO LONGER CONVERTED, and that is the fix for `CT-124`'s second
// half. The conversion was here to stop a EUR payment closing a USD charge --
// but it never did that: converting makes the amounts comparable, it does not
// separate the ledgers, and the walk was still one queue for both currencies.
// `buildChargeLedger` now keeps one ledger per currency, exactly like
// `get_open_charges_for_client`, so each is measured in its own money.
//
// It also removes a bug the conversion caused: converted amounts carry
// decimals the database never stores, the walk rounds at every step, and a
// 3 EUR fiado paid with three 1 EUR payments ended at 0.01 and never closed --
// then counted as paid late.
//
// EVERY MOVEMENT, NOT THE FIRST THOUSAND (PL-35). This read used to be one request, and the
// API cuts at 1,000 rows without an error. A business with 1,228 movements got its list
// scored from a part of them, while the client's own page, which reads one client, stayed
// right: the same client with two scores. The owner's words: *«Si Marta decide a quién
// fiarle por la lista, puede negarle crédito a su mejor cliente»*. `qa:lecturas-completas`
// compares the list with each client's page.
//
// IF THE READ FAILS THERE ARE NO SCORES, AND THAT IS ON PURPOSE. Scoring what arrived is the
// bug above, and throwing would take Inicio down over a secondary figure; `client-table`
// draws a row with no score. It used to fail worse: an error left `movements` null and every
// client was scored as if they had no history.
export async function computeCreditScoresForClients(
  supabase: SupabaseServerClient,
  rows: ClientSummary[],
  effectiveRate: EffectiveRate | null = null,
): Promise<Record<string, CreditScoreResult>> {
  const clientIds = rows.map((r) => r.client_id);
  if (clientIds.length === 0) return {};

  let movements: (ScoredMovement & { client_id: string })[];
  let flags: { client_id: string; unflagged_at: string | null }[];
  try {
    [movements, flags] = await Promise.all([
      readAllByIds<ScoredMovement & { client_id: string }>(clientIds, (batch, from, to) =>
        supabase
          .from("movements")
          .select("id, client_id, type, amount, currency, created_at, plazo_dias, applies_to_movement_id", {
            count: "exact",
          })
          .in("client_id", batch)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
      readAllByIds<{ client_id: string; unflagged_at: string | null }>(clientIds, (batch, from, to) =>
        supabase
          .from("client_flags")
          .select("client_id, unflagged_at", { count: "exact" })
          .in("client_id", batch)
          .not("unflagged_at", "is", null)
          .order("unflagged_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ]);
  } catch (e) {
    console.error("[puntaje] lectura:", e instanceof Error ? e.message : e);
    return {};
  }

  const movementsByClient = new Map<string, ScoredMovement[]>();
  for (const m of movements) {
    const list = movementsByClient.get(m.client_id) ?? [];
    list.push(m);
    movementsByClient.set(m.client_id, list);
  }

  // Ordered by unflagged_at desc, so the first row seen per client is its
  // most recent unflag. All of a client's rows fall in the same batch of ids.
  const lastUnflagByClient = new Map<string, string>();
  for (const f of flags) {
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
      worstChargeAt: row.worst_unpaid_charge_at ?? null,
      worstChargePlazoDias: row.worst_unpaid_charge_plazo_dias ?? null,
      worstChargeDueAt: row.worst_unpaid_charge_due_at ?? null,
      isFlagged: row.is_flagged,
      mostRecentUnflaggedAt: lastUnflagByClient.get(row.client_id) ?? null,
    });
  }
  return scores;
}
