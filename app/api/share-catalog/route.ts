import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";

export const runtime = "nodejs";

// ===========================================================================
// BUSINESS QUESTION
//
// «¿Cuántos clientes acceden al catálogo desde el link compartido?» -- the
// owner's own words, 2026-10-17, when he commissioned the "Productos" strip.
//
// WHAT EACH ANSWER CHANGES, because a number with no decision behind it is a
// column nobody opens again:
//
//   - If a large share of clients tap through, the balance link is doing
//     something it was never built for: it is a storefront people reach by
//     way of their debt. That makes the catalogue worth putting in front of
//     clients who have no balance at all, and it makes the strip's position
//     on the page -- above the history -- worth defending rather than an
//     experiment.
//
//   - If almost nobody taps, the shop's products are not what a client opens
//     this link for, and the honest move is to shrink the strip or drop it,
//     not to make it louder. The page's one job is the balance, and we would
//     have measured the cost of the detour instead of guessing at it.
//
//   - And a count near zero for a business WITH a catalogue and products
//     published is a different finding again: it points at the strip not
//     being seen, which is a layout question, not a demand question.
//
// THE EVENT LANDS ON THE OWNER'S MIXPANEL PROFILE, not the client's. The
// question is about a business and a client has no profile here -- the same
// resolution, through the same function, as `Business Contacted On WhatsApp`.
//
// IT IS A FLOOR, NOT A HEADCOUNT, and that has to be said next to the number
// or somebody will present it as exact in six months. It counts TAPS, so one
// client who goes back and forth counts more than once; and it is sent by the
// browser, so an iOS Safari that drops the request loses it. CLAUDE.md's rule
// about iPhone is why this is the only part of the feature the browser does:
// the strip itself, the products and the link are all resolved on the server.
// ===========================================================================
//
// WHY A PUBLIC ROUTE OF ITS OWN, INSTEAD OF /api/track
//
// Identical to `/api/share-contact`, which this is modelled on: `/api/track`
// resolves `distinct_id` from the session and answers 204 to anyone without
// one, deliberately, because a body-supplied id would let a caller write
// events onto another owner's profile. This page has no session -- the person
// tapping is the client.
//
// So this route accepts NOTHING but a token and emits ONE fixed event name
// with no caller-supplied properties. That is the whole defence: a public
// endpoint that forwarded arbitrary event names into Mixpanel would be a
// graffiti wall. The token is not a secret the caller is proving -- it is in
// their address bar -- it is only how the server finds out which business to
// file under.

export async function POST(request: Request) {
  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" && body.token.length <= 128 ? body.token : null;
  } catch {
    token = null;
  }

  // 204 and never an error, for the same reason `/api/share-contact` does it:
  // analytics must not become something the caller has to handle, and this one
  // is public, so an error body is a free hint about what sits behind it. The
  // real reason goes to the server log only -- CLAUDE.md's rule on masking
  // errors on unauthenticated endpoints.
  if (!token) return new NextResponse(null, { status: 204 });

  try {
    const { data, error } = await createServiceClient().rpc("share_link_owner", {
      p_token: token,
    });
    if (error) {
      console.error("[share-catalog] share_link_owner:", error.message);
      return new NextResponse(null, { status: 204 });
    }

    const owner = data as { owner_id: string; owner_email: string | null } | null;
    // An unknown token resolves to null. Nothing is recorded: an event filed
    // under a guessed owner is worse than a missing one.
    if (!owner?.owner_id) return new NextResponse(null, { status: 204 });

    trackServer(
      "Catalog Opened From Share Link",
      owner.owner_id,
      { surface: "shared_balance" },
      owner.owner_email,
    );
  } catch (e) {
    console.error("[share-catalog] threw:", e instanceof Error ? e.message : e);
  }

  return new NextResponse(null, { status: 204 });
}
