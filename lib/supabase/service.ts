import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS entirely. Only ever used server-side by
// the exchange-rate fetch route (app/api/cron/exchange-rate) — that route
// runs with no owner session (triggered by Vercel Cron or a manual curl,
// not a logged-in user), and bcv_exchange_rate_fetches deliberately grants
// no direct insert access to authenticated/anon (see supabase/schema.sql).
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
