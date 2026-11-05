import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { linkOwner } from "@/lib/analytics/link-owner";
import { cleanPublicProps, isPublicEventCode, PUBLIC_EVENTS } from "@/lib/analytics/public-events";
import type { EventName, EventProps } from "@/lib/analytics/events";

export const runtime = "nodejs";

// THE CLIENT SIDE OF THE FUNNELS. Owner's request of 2026-11-04: *«Implementemos
// la ruta pública»*, to see whether the links a shop sends get opened, and where a
// catalogue visit stops before becoming an order.
//
// WHY IT IS A ROUTE OF ITS OWN. `/api/track` needs a session and a client has
// none: the middleware answers 307 and the event is lost in silence. It is exempted
// in `lib/supabase/middleware.ts`, and without that line this route is dead the
// same way `/api/share-catalog` was from 2026-10-17 to 2026-11-04.
//
// ANYONE CAN CALL THIS, so everything here is about what they cannot do:
//   · The event name is never theirs: a code from `PUBLIC_EVENTS` or nothing.
//   · Undeclared properties are dropped, so no text reaches Mixpanel.
//   · The owner comes from the token, and an unknown token records nothing.
//   · 300 events per link per hour. The limiter answers «no» at once.
//   · Always 204, even on failure: an error body is a free hint about what sits
//     behind it. The real reason goes to the server log only, per CLAUDE.md.
//
// THE TOKEN IS NOT A SECRET and the origin check only keeps out the lazy, so these
// numbers are a floor and a script can inflate them. They guide product decisions;
// money is always counted in Supabase.

const MAX_BODY_BYTES = 2_000;
const EVENTS_PER_LINK_PER_HOUR = 300;

const nothing = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return nothing();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return nothing();

  let body: { token?: unknown; code?: unknown; props?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return nothing();
  }

  const { token, code } = body;
  if (typeof token !== "string" || token.length === 0 || token.length > 128) return nothing();
  if (!isPublicEventCode(code)) return nothing();

  const spec = PUBLIC_EVENTS[code];

  try {
    const owner = await linkOwner(spec.surface, token);
    if (!owner) return nothing();

    // AFTER RESOLVING THE TOKEN, so made-up tokens cannot fill the limiter's table.
    // FAILS CLOSED, unlike the limiter in `app/s/[token]/actions.ts`: there a client
    // would lose an answer, here the cost is one event.
    const { data: allowed, error } = await createServiceClient().rpc("claim_rate_limit_quota", {
      p_key: `public_event:${token}`,
      p_limit: EVENTS_PER_LINK_PER_HOUR,
      p_window_seconds: 3600,
    });
    if (error || allowed === false) {
      if (error) console.error("[public-event] limiter:", error.message);
      return nothing();
    }

    // THE SHOPKEEPER OPENS THEIR OWN LINKS TOO. Reading the cookie's name costs no
    // network call, and it lets a report leave those visits out.
    const viewerSignedIn = /(?:^|;\s*)sb-[^=]*-auth-token/.test(request.headers.get("cookie") ?? "");

    trackServer(
      spec.event as EventName,
      owner.owner_id,
      {
        ...cleanPublicProps(code, body.props),
        ...(owner.client_id ? { client_id: owner.client_id } : {}),
        viewer_signed_in: viewerSignedIn,
      } as EventProps[EventName],
      owner.owner_email,
    );
  } catch (e) {
    console.error("[public-event] threw:", e instanceof Error ? e.message : e);
  }

  return nothing();
}
