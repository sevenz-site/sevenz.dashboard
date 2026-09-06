import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS entirely. Two server-side callers, both
// of which run outside any owner session:
//
//   - the exchange-rate fetch route (app/api/cron/exchange-rate), triggered by
//     Vercel Cron or a manual curl rather than a logged-in user, writing to
//     bcv_exchange_rate_fetches, which grants no insert to authenticated/anon
//     (see supabase/schema.sql)
//   - lib/admin/metrics.ts, whose figures span every owner by definition —
//     gated by lib/admin/guard.ts before any of it runs
//
// Note that bypassing RLS is not the same as having table privileges. In
// production, SELECT is revoked from service_role on the customer tables, so
// this client cannot read `owners` or `movements` directly no matter what RLS
// says; the admin reads go through SECURITY DEFINER functions instead. Adding
// a third caller means checking the grants in production, not just in dev.
//
// Never import this from a client component, and never expose
// SUPABASE_SERVICE_ROLE_KEY as a NEXT_PUBLIC_ var.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL no están configuradas.");
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
