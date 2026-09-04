import { after } from "next/server";
import { mixpanelConfigured, sendEvent } from "@/lib/mixpanel-http";

// Server-side counterpart to lib/mixpanel.ts. The browser version depends on
// the user's device being willing to reach api.mixpanel.com — iOS Safari,
// Brave and any content blocker refuse, which is how a daily-active owner
// showed up in Mixpanel as having churned nine days earlier while Supabase
// recorded 31 movements from him. Events sent from here can't be blocked by
// anything on the client.
//
// Three properties make this safe to call from the middle of a money-path
// action:
//
//   1. after() runs the callback once the response has already been sent, so
//      a slow or dead Mixpanel can never delay or fail the owner's save. A
//      plain un-awaited fetch would NOT do this — Vercel can freeze the
//      function the moment it returns, silently dropping the request.
//   2. The whole body — including the after() registration itself — is
//      wrapped so that nothing analytics-related can ever propagate into the
//      caller. A failed fiado because a metrics call threw would be a far
//      worse bug than the missing metrics this file exists to fix.
//   3. The request is capped by a timeout. fetch() has none by default, and
//      after() holds the serverless function open until its callback settles,
//      so an unresponsive Mixpanel would otherwise keep the function billing
//      until Vercel's own limit killed it.
//
// distinct_id is the owner's id. The browser path now resolves the same id
// server-side in app/api/track/route.ts, so events from both routes land on
// one profile. The actual HTTP call lives in lib/mixpanel-http.ts, shared with
// that route so there is a single implementation to keep correct.

export function trackServer(
  event: string,
  ownerId: string,
  props?: Record<string, unknown>,
  // Sent as $set so the profile stays current even for owners whose browser
  // never lets identifyOwner() run — that's what leaves "Updated at" stale.
  ownerEmail?: string | null,
) {
  if (!mixpanelConfigured()) return;

  try {
    after(async () => {
      await sendEvent(
        event,
        ownerId,
        props,
        "server",
        ownerEmail ? { $email: ownerEmail } : undefined,
      );
    });
  } catch (error) {
    // after() itself refusing (e.g. called outside a request scope) must not
    // take the owner's save down with it.
    console.error(
      `[mixpanel] no se pudo programar "${event}":`,
      error instanceof Error ? error.message : error,
    );
  }
}
