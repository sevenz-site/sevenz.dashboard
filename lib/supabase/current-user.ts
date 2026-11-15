import "server-only";
import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// ONE SERVER CLIENT, ONE AUTH CALL, ONE OWNERS ROW PER REQUEST (phase 2 of
// ../docs/RENDIMIENTO-PLAN.md, steps 1 and 2).
//
// Before this, a single Inicio load asked Supabase Auth four times — the
// proxy, the layout, the page and getUnreadNotificationCount — and read
// `owners` at least four times. The layout and the page render in parallel
// inside the same request, so React's `cache()` lets them share one answer.
//
// WHAT THIS DOES NOT REPLACE: the proxy's own `getUser()` in
// lib/supabase/middleware.ts. «No fui yo» works because the proxy asks Auth on
// every request and Auth refuses a killed session; that call stays exactly
// where it is. This only removes the repeats AFTER the proxy has already asked.
//
// OUTSIDE A RENDER (server actions, route handlers) React does not memoize:
// each call runs as if `cache()` were not there. That is intended — the
// actions keep doing what they did, and nothing here is relied on there.

// The request's server client. Shared so that the cached loaders below, which
// key on the client instance, hit across the layout and the page.
export const getRequestClient = cache(createClient);

// The signed-in user, validated against Supabase Auth once per request.
// Same contract as `(await supabase.auth.getUser()).data.user`: null when
// there is no session or Auth could not be reached.
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await getRequestClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// The columns of `owners` that the shell and the rate helpers need. One fixed
// list on purpose: `cache()` keys on the arguments, so a per-caller column list
// would be a cache miss per caller and bring back the repeated reads. A screen
// that needs another column keeps its own query rather than widening this one
// to `*`.
export const OWNER_SHELL_COLUMNS = "business_name, onboarding_completed_at, plan, country";

export type OwnerShellRow = {
  business_name: string | null;
  onboarding_completed_at: string | null;
  plan: string | null;
  country: string | null;
};

// Same `{ data, error }` shape as the query it replaces, so callers that only
// read `data` change nothing else. Keyed on the client instance and the id:
// a caller passing its own client (a route handler, the service client) gets
// its own read, never another client's answer.
export const getOwnerShellRow = cache(
  async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: SupabaseClient<any, any, any>,
    ownerId: string,
  ): Promise<{ data: OwnerShellRow | null; error: unknown }> => {
    const { data, error } = await supabase
      .from("owners")
      .select(OWNER_SHELL_COLUMNS)
      .eq("id", ownerId)
      .maybeSingle();
    return { data: (data as OwnerShellRow | null) ?? null, error };
  },
);
