import type { createClient } from "@/lib/supabase/server";
import { FREE_PLAN_MONTHLY_IMPORT_LIMIT } from "@/lib/config";
import type { OwnerPlan } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImportUsage = {
  plan: OwnerPlan;
  used: number;
  limit: number | null;
  remaining: number | null;
};

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Shared by the /api/extract route (authoritative gate, prevents bypass) and
// the import page/provider (drives the progress bar). Only 'done' rows count
// — a failed OCR read shouldn't burn the owner's monthly quota.
export async function getImportUsageForOwner(
  supabase: SupabaseServerClient,
  ownerId: string,
): Promise<ImportUsage> {
  const [{ data: owner }, { count }] = await Promise.all([
    supabase.from("owners").select("plan").eq("id", ownerId).single(),
    supabase
      .from("import_notifications")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("status", "done")
      .gte("created_at", startOfCurrentMonthIso()),
  ]);

  const plan: OwnerPlan = owner?.plan === "pro" ? "pro" : "free";
  const used = count ?? 0;

  if (plan === "pro") {
    return { plan, used, limit: null, remaining: null };
  }

  const limit = FREE_PLAN_MONTHLY_IMPORT_LIMIT;
  return { plan, used, limit, remaining: Math.max(0, limit - used) };
}
