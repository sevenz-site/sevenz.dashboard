import { todayInCaracas } from "@/lib/exchange-rate/rate-status";

// `refresh_stock_alerts` AT MOST ONCE A DAY PER OWNER AND BROWSER (phase 2 of
// ../docs/RENDIMIENTO-PLAN.md, step 4), without a migration.
//
// WHY ONCE A DAY IS ENOUGH. The RPC only exists to raise TOMORROW's notice for
// a product that is still low and nobody touched (migration 183, «cada día
// mientras siga bajo»). Every same-day change is already covered elsewhere:
// the triggers on `products` (stock_opening, trashed_at) and on `owners`
// (low_stock_threshold) call sync_stock_alert the moment the count or the
// threshold moves, from whatever device or door the change came through. So
// skipping the RPC for the rest of the day loses nothing a trigger would not
// already have written. And opening the bell (getNotifications) still runs
// the RPC every time, unchanged.
//
// WHERE IT RUNS. In the proxy, on the first page visit of the Venezuelan day,
// awaited before the page renders so the layout's badge count sees the new
// rows (the order the layout used to guarantee by chaining). The proxy then
// leaves this cookie. The layout runs the RPC itself only when the cookie it
// sees is not today's — the app left open past midnight and only navigated
// client-side, or the proxy's call failed — which is exactly when the old
// code would have run it too.
//
// WHY THE PROXY AND NOT THE LAYOUT ALONE: a Server Component cannot set a
// cookie, and Next merges cookies the proxy sets into `cookies()` for the same
// request (x-middleware-set-cookie), so "proxy sets, layout runs" would make
// the layout see today's value and skip on the very first load.
//
// The owner id is part of the value so a second account signed in on the same
// browser the same day still gets its own refresh.
export const STOCK_ALERTS_DAY_COOKIE = "sz_stock_day";

export function stockAlertsDayValue(ownerId: string): string {
  // Caracas, not the server clock: Vercel runs in UTC and would start the
  // next day at 8 p.m. in Venezuela.
  return `${ownerId}:${todayInCaracas()}`;
}

export function stockAlertsDayCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    // Two days: the value carries its own date, so the lifetime only has to
    // outlast one day; it is not what decides when the RPC runs again.
    maxAge: 2 * 24 * 3600,
  };
}
