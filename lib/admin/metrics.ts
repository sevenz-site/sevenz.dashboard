import { createServiceClient } from "@/lib/supabase/service";
import { computeCreditScore } from "@/lib/credit-score";
import type { Movement } from "@/lib/types";

// Server-side only: every function here uses the service-role client, which
// bypasses RLS by design because these figures span every owner. Nothing in
// this file may be imported from a client component. The gate deciding who is
// allowed to see the results lives in lib/admin/guard.ts, not here — this
// module assumes it has already run.

export type MetricFilters = {
  country?: "CO" | "VE" | null;
  currency?: "COP" | "USD" | "EUR" | null;
  ownerId?: string | null;
  from?: string | null;
  to?: string | null;
};

export type CurrencySummary = {
  currency: string;
  movements_total: number;
  charges_count: number;
  charge_total: number;
  charge_average: number | null;
  payments_count: number;
  payment_total: number;
  payment_average: number | null;
  plazo_average: number | null;
  charges_with_plazo: number;
};

export type Totals = {
  clients_created: number;
  clients_flagged_now: number;
  mala_paga_labelled: number;
  mala_paga_unlabelled: number;
};

export type TrendPoint = {
  bucket: string;
  movements: number;
  charges: number;
  payments: number;
  charge_total: number;
  payment_total: number;
  clients_created: number;
};

export type OwnerRow = {
  owner_id: string;
  business_name: string;
  country: string;
  clients: number;
  movements: number;
  charge_total: number;
  payment_total: number;
  last_activity: string | null;
};

export type Bucket = "day" | "week" | "month";

// The RPCs take the same five arguments in the same shape, so the mapping is
// written once. Undefined and empty string both mean "no filter" — a filter bar
// submits "" for a cleared select, and passing that through as a value would
// silently match nothing.
function rpcArgs(f: MetricFilters) {
  const nullable = (v: string | null | undefined) => (v && v.length > 0 ? v : null);
  return {
    p_country: nullable(f.country),
    p_currency: nullable(f.currency),
    p_owner: nullable(f.ownerId),
    p_from: nullable(f.from),
    p_to: nullable(f.to),
  };
}

export async function getCurrencySummary(f: MetricFilters): Promise<CurrencySummary[]> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_metrics_summary", rpcArgs(f));
  if (error) throw new Error(`admin_metrics_summary: ${error.message}`);
  return (data ?? []) as CurrencySummary[];
}

export async function getTotals(f: MetricFilters): Promise<Totals> {
  const db = createServiceClient();
  const { p_country, p_owner, p_from, p_to } = rpcArgs(f);
  const { data, error } = await db.rpc("admin_metrics_totals", { p_country, p_owner, p_from, p_to });
  if (error) throw new Error(`admin_metrics_totals: ${error.message}`);
  // The function returns a single row; supabase-js still wraps it in an array.
  const row = (Array.isArray(data) ? data[0] : data) as Totals | undefined;
  return row ?? { clients_created: 0, clients_flagged_now: 0, mala_paga_labelled: 0, mala_paga_unlabelled: 0 };
}

export async function getTrend(f: MetricFilters, bucket: Bucket = "week"): Promise<TrendPoint[]> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_metrics_timeseries", { p_bucket: bucket, ...rpcArgs(f) });
  if (error) throw new Error(`admin_metrics_timeseries: ${error.message}`);
  return (data ?? []) as TrendPoint[];
}

export async function getByOwner(f: MetricFilters): Promise<OwnerRow[]> {
  const db = createServiceClient();
  const { p_country, p_currency, p_from, p_to } = rpcArgs(f);
  const { data, error } = await db.rpc("admin_metrics_by_owner", { p_country, p_currency, p_from, p_to });
  if (error) throw new Error(`admin_metrics_by_owner: ${error.message}`);
  return (data ?? []) as OwnerRow[];
}

// Owners, for the filter bar's select.
export async function getOwnerOptions(): Promise<{ id: string; business_name: string; country: string }[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("owners")
    .select("id, business_name, country")
    .order("business_name");
  if (error) throw new Error(`owners: ${error.message}`);
  return data ?? [];
}

// The one metric that cannot be aggregated in SQL.
//
// computeCreditScore is ~200 lines of weighted TypeScript evaluated at render
// and never stored. Reimplementing it in PL/pgSQL would leave two versions free
// to drift, and the average shown to an investor would stop matching the number
// an owner sees on their own screen — so this reuses the real implementation.
//
// Known ceiling, stated rather than hidden: it needs every movement for every
// client in scope, so unlike the aggregates above it grows with the data. Fine
// at current volume. When it stops being fine the answer is persisting the
// score on write, not rewriting it in SQL.
export async function getAverageCreditScore(
  f: MetricFilters,
): Promise<{ average: number | null; clients: number }> {
  const db = createServiceClient();

  let ownersQuery = db.from("owners").select("id");
  if (f.country) ownersQuery = ownersQuery.eq("country", f.country);
  if (f.ownerId) ownersQuery = ownersQuery.eq("id", f.ownerId);
  const { data: owners } = await ownersQuery;
  const ownerIds = new Set((owners ?? []).map((o) => o.id));
  if (ownerIds.size === 0) return { average: null, clients: 0 };

  // Paged for the same reason the movements loop below is: PostgREST returns
  // at most 1,000 rows and says nothing about the ones it dropped. Unpaged,
  // the "average across every client" would quietly become "average across an
  // arbitrary thousand" the day the platform passes that mark.
  const summaries: Record<string, unknown>[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("client_summary")
      .select("*")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`client_summary: ${error.message}`);
    summaries.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  const scoped = summaries.filter((r) => {
    if (!ownerIds.has(r.owner_id as string)) return false;
    if (f.from && (r.client_created_at as string) < f.from) return false;
    if (f.to && (r.client_created_at as string) >= f.to) return false;
    return true;
  });
  if (scoped.length === 0) return { average: null, clients: 0 };

  const clientIds = scoped.map((r) => r.client_id as string);

  // Paged: PostgREST caps a plain select at 1,000 rows and truncates without
  // erroring. A partial movement list would not fail loudly here — it would
  // quietly produce a wrong score, which is worse.
  const movements: Movement[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from("movements")
      .select("id, client_id, type, amount, currency, plazo_dias, created_at")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .order("created_at")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`movements: ${error.message}`);
    movements.push(...((data ?? []) as Movement[]));
    if (!data || data.length < 1000) break;
  }

  const { data: flags } = await db.from("client_flags").select("client_id, unflagged_at");
  const lastUnflagged = new Map<string, string>();
  for (const f2 of flags ?? []) {
    if (!f2.unflagged_at) continue;
    const prev = lastUnflagged.get(f2.client_id as string);
    if (!prev || new Date(f2.unflagged_at as string) > new Date(prev)) {
      lastUnflagged.set(f2.client_id as string, f2.unflagged_at as string);
    }
  }

  const byClient = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byClient.get(m.client_id) ?? [];
    list.push(m);
    byClient.set(m.client_id, list);
  }

  const scores = scoped.map(
    (r) =>
      computeCreditScore({
        movements: byClient.get(r.client_id as string) ?? [],
        balance: Number(r.balance ?? 0),
        daysSincePayment: Number(r.days_since_payment ?? 0),
        oldestUnpaidChargeAt: (r.oldest_unpaid_charge_at as string | null) ?? null,
        oldestUnpaidChargePlazoDias: (r.oldest_unpaid_charge_plazo_dias as number | null) ?? null,
        isFlagged: Boolean(r.is_flagged),
        mostRecentUnflaggedAt: lastUnflagged.get(r.client_id as string) ?? null,
      }).score,
  );

  return {
    average: Math.round(scores.reduce((s, n) => s + n, 0) / scores.length),
    clients: scores.length,
  };
}
