import { after } from "next/server";

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
// distinct_id is the owner's id, matching mixpanel.identify(ownerId) on the
// client, so server and browser events land on the same profile.
const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

const TIMEOUT_MS = 5000;

export function trackServer(
  event: string,
  ownerId: string,
  props?: Record<string, unknown>,
  // Sent as $set so the profile stays current even for owners whose browser
  // never lets identifyOwner() run — that's what leaves "Updated at" stale.
  ownerEmail?: string | null,
) {
  if (!MIXPANEL_TOKEN) return;

  try {
    after(async () => {
      try {
        const payload = [
          {
            event,
            properties: {
              token: MIXPANEL_TOKEN,
              distinct_id: ownerId,
              time: Date.now(),
              // Makes the event idempotent: if this ever gets retried, Mixpanel
              // discards the duplicate instead of double-counting.
              $insert_id: crypto.randomUUID(),
              source: "server",
              ...props,
              ...(ownerEmail ? { $set: { $email: ownerEmail } } : {}),
            },
          },
        ];

        // verbose=1 makes Mixpanel answer with a JSON reason instead of a bare
        // "0", which is the difference between a debuggable failure and a
        // silent one.
        const res = await fetch("https://api.mixpanel.com/track?verbose=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        // Mixpanel answers {"error":null,"status":1} — parsed rather than
        // string-matched, since the exact spacing isn't part of any contract
        // and a substring check silently reports every success as a failure.
        const body = await res.text();
        let accepted = false;
        try {
          accepted = (JSON.parse(body) as { status?: number }).status === 1;
        } catch {
          accepted = false;
        }
        if (!res.ok || !accepted) {
          console.error(`[mixpanel] "${event}" rechazado (${res.status}):`, body);
        }
      } catch (error) {
        console.error(
          `[mixpanel] "${event}" falló:`,
          error instanceof Error ? error.message : error,
        );
      }
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
