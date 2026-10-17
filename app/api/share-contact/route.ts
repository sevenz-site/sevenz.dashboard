import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";

export const runtime = "nodejs";

// ===========================================================================
// BUSINESS QUESTION
//
// «¿Con cuál frecuencia los clientes contactan al dueño del negocio a través
// del botón de WhatsApp?» -- the owner's own words, 2026-10-16.
//
// It is the only measure we have of whether the share link starts a
// conversation or ends one. The link exists so a client can check their
// balance without asking; if most of them check it and then write anyway, the
// page is not answering what they came for, and WHAT they ask next is the
// thing to go and read. If almost nobody writes, the page is doing its job
// and the button is a safety net rather than a step.
//
// The event lands on the OWNER's Mixpanel profile, not the client's: the
// question is about a business, and a client has no profile here.
// ===========================================================================
//
// WHY A PUBLIC ROUTE OF ITS OWN, INSTEAD OF /api/track
//
// `/api/track` resolves `distinct_id` from the session and answers 204 to
// anyone without one -- deliberately, because a body-supplied id would let a
// caller write events onto another owner's profile. This page has no session:
// the person tapping is the client.
//
// So this route accepts NOTHING but a token, and emits ONE fixed event name
// with no caller-supplied properties. That is the whole defence: it is a
// public endpoint, and a public endpoint that forwarded arbitrary event names
// into Mixpanel would be a graffiti wall. The token is not a secret the
// caller is proving -- they already hold it, it is in their address bar --
// it is only how the server finds out which business to file under.
//
// WHY THE BROWSER SENDS IT AT ALL, given CLAUDE.md's rule that what matters is
// recorded by the server: a tap on a link is not something the server can
// observe without putting itself between the client and WhatsApp. The
// alternative was a redirect -- `/s/[token]/whatsapp` recording and then
// bouncing to `wa.me` -- which cannot lose an event but adds a hop before
// WhatsApp opens, on a phone, on a Venezuelan connection, for a person who
// just wants to write a message. The tap stays instant and the count is
// approximate by design.
//
// What makes that trade acceptable is the SAME thing that makes `/api/track`
// work: this is a FIRST-PARTY request. The reason browser events used to
// vanish was that they went to api.mixpanel.com, which iOS Safari and every
// content blocker drop on sight. A POST to the app's own origin is
// indistinguishable from the rest of the app's traffic. The caller sends it
// with `keepalive`, so it survives the navigation that raised it.

export async function POST(request: Request) {
  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" && body.token.length <= 128 ? body.token : null;
  } catch {
    token = null;
  }

  // 204 and never an error, for the same reason `/api/track` does it:
  // analytics must not become something the caller has to handle, and this
  // one is public, so an error body is a free hint about what exists behind
  // it. The real reason goes to the server log only (CLAUDE.md's rule on
  // unauthenticated endpoints).
  if (!token) return new NextResponse(null, { status: 204 });

  try {
    const { data, error } = await createServiceClient().rpc("share_link_owner", {
      p_token: token,
    });
    if (error) {
      console.error("[share-contact] share_link_owner:", error.message);
      return new NextResponse(null, { status: 204 });
    }

    const owner = data as { owner_id: string; owner_email: string | null } | null;
    // An unknown token resolves to null. Nothing is recorded: an event filed
    // under a guessed owner is worse than a missing one.
    if (!owner?.owner_id) return new NextResponse(null, { status: 204 });

    trackServer("Business Contacted On WhatsApp", owner.owner_id, { surface: "shared_balance" }, owner.owner_email);
  } catch (e) {
    console.error("[share-contact] threw:", e instanceof Error ? e.message : e);
  }

  return new NextResponse(null, { status: 204 });
}
