import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { linkOwner } from "@/lib/analytics/link-owner";
import { cachedUsdtPrice } from "@/lib/exchange-rate/usdt-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE USDT PRICE FOR THE CLIENT'S CALCULATOR on `/s/[token]`. Owner's request of
// 2026-11-19: «En el link compartido del cliente debemos agregar la calculadora»,
// with USDT alongside dollars and euros.
//
// WHY NOT `/api/usdt`. That one wants a session, and a client has none: the
// middleware would answer 307 and the tab would simply never appear, with
// nothing saying why. This route is exempted in `lib/supabase/middleware.ts`.
//
// ANYONE CAN CALL THIS, so here is what they cannot do:
//   · Without a real balance-link token they get `{ usdt: null }`, the same
//     answer as «no price right now». Nothing says whether the token exists.
//   · They cannot make us hit CriptoYa more often: the price comes from the
//     60-second cache shared with the owner's route (`usdt-cache.ts`).
//   · They cannot hammer the database for free either: 120 calls per link per
//     hour through the same limiter as `/api/public-event`. A calculator opened
//     every 30 seconds for an hour is still under it.
//   · Errors never reach the body (CLAUDE.md, «Mask raw errors on
//     unauthenticated endpoints»). The reason goes to the server log only.
//
// POST AND NOT GET, so the token travels in the body and not in a URL that ends
// up in access logs. It is already in the client's address bar, but that is no
// reason to copy it into more places.

const CALLS_PER_LINK_PER_HOUR = 120;

const none = () => NextResponse.json({ usdt: null }, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" && body.token.length > 0 && body.token.length <= 128 ? body.token : null;
  } catch {
    token = null;
  }
  if (!token) return none();

  try {
    const owner = await linkOwner("balance", token);
    if (!owner) return none();

    // After resolving the token, so made-up tokens cannot fill the limiter's
    // table. Fails closed: the cost is the USDT tab, not the balance.
    const service = createServiceClient();
    const { data: allowed, error } = await service.rpc("claim_rate_limit_quota", {
      p_key: `share_usdt:${token}`,
      p_limit: CALLS_PER_LINK_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (error || allowed === false) {
      if (error) console.error("[share-usdt] limiter:", error.message);
      return none();
    }

    const { usdt } = await cachedUsdtPrice(async () => {
      const { data: oficial } = await service.rpc("get_current_bcv_rate").maybeSingle();
      return (oficial as { usd?: number } | null)?.usd;
    });
    return NextResponse.json({ usdt }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[share-usdt] threw:", e instanceof Error ? e.message : e);
    return none();
  }
}
