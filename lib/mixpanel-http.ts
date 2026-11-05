import "server-only";

import type { EventContext } from "@/lib/mixpanel-context";

// The one place that actually talks to api.mixpanel.com. Both callers are on
// the server by design:
//
//   - lib/mixpanel-server.ts, for events raised inside a server action
//   - app/api/track/route.ts, the proxy that browser events post to
//
// Nothing in the browser may call Mixpanel directly. iOS Safari's tracking
// protection and every content blocker drop requests to api.mixpanel.com, so
// a browser-sent event is silently lost on a large share of this app's real
// traffic — see CLAUDE.md's iPhone rule, and the September 2026 incident where
// a daily-active owner appeared churned.

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
const TIMEOUT_MS = 5000;

export function mixpanelConfigured(): boolean {
  return Boolean(MIXPANEL_TOKEN);
}

// verbose=1 makes Mixpanel answer with a JSON reason instead of a bare "0",
// which is the difference between a debuggable failure and a silent one.
async function post(endpoint: "track" | "engage", payload: unknown, label: string): Promise<void> {
  try {
    const res = await fetch(`https://api.mixpanel.com/${endpoint}?verbose=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Mixpanel answers {"error":null,"status":1} — parsed rather than
    // string-matched, since the exact spacing isn't part of any contract and a
    // substring check silently reports every success as a failure.
    const body = await res.text();
    let accepted = false;
    try {
      accepted = (JSON.parse(body) as { status?: number }).status === 1;
    } catch {
      accepted = false;
    }
    if (!res.ok || !accepted) {
      console.error(`[mixpanel] ${label} rechazado (${res.status}):`, body);
    }
  } catch (error) {
    console.error(`[mixpanel] ${label} falló:`, error instanceof Error ? error.message : error);
  }
}

// `sent_from` distinguishes an event raised inside a server action from one a
// browser posted to the proxy, so a future drop in "browser" events is
// visible in Mixpanel itself rather than having to be inferred.
//
// IT WAS CALLED `source` UNTIL 2026-11-04, and that name was taken. From 2026-09-05,
// when trusted fields moved below `...props`, it silently replaced the `source` of
// every event that has one: `Client Details Opened` came from «cartera» or
// «papelera» in the code and arrived as «browser». Found when a new event's own
// `source` failed its test. Any field written below the spread is a reserved name.
export async function sendEvent(
  event: string,
  distinctId: string,
  props: Record<string, unknown> | undefined,
  source: "server" | "browser",
  profile?: Record<string, unknown>,
  // Device and geography, derived from the request headers rather than from
  // anything the caller passed. See lib/mixpanel-context.ts.
  context?: EventContext,
): Promise<void> {
  if (!MIXPANEL_TOKEN) return;
  const payload = [
    {
      event,
      properties: {
        // props FIRST, and everything trustworthy after it.
        //
        // This spread used to come last, which quietly handed the browser
        // control of every field above it. app/api/track/route.ts passes the
        // request body's props straight through, so a signed-in owner could
        // post props:{distinct_id:"<another owner's id>"} and write events
        // onto that owner's profile — exactly what the route's comment
        // promises cannot happen. token (redirecting events to another
        // project) and source (poisoning the browser-vs-server diagnostic)
        // were overridable the same way.
        //
        // Ordering is the fix rather than key-stripping: there is no list of
        // reserved names to keep in sync, and a new trusted field is safe by
        // virtue of being written below.
        ...props,
        token: MIXPANEL_TOKEN,
        distinct_id: distinctId,
        // The owner as a plain property too, by the owner's decision of
        // 2026-11-04: `distinct_id` cannot be used to break a report down, and
        // this can. Written here, so no event can forget it or fake it.
        owner_id: distinctId,
        time: Date.now(),
        // Makes the event idempotent: if this ever gets retried, Mixpanel
        // discards the duplicate instead of double-counting.
        $insert_id: crypto.randomUUID(),
        sent_from: source,
        ...context,
        ...(profile ? { $set: profile } : {}),
      },
    },
  ];

  // A LOCAL COPY OF EXACTLY WHAT WOULD BE SENT, FOR `qa/eventos-transacciones.mjs`.
  // Without it no suite can see an event leave: a missing one fails nothing, which
  // is how `Movement Added` went unnoticed. Set only on a dev server started for
  // QA, and then nothing reaches Mixpanel. Production never has this variable.
  if (process.env.ANALYTICS_QA_LOG && process.env.NODE_ENV !== "production") {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.ANALYTICS_QA_LOG, `${JSON.stringify(payload[0])}
`);
    return;
  }

  await post("track", payload, `"${event}"`);
}

// Profile update with no accompanying event — the replacement for the browser
// SDK's identify()/people.set(), which never reached Mixpanel from an iPhone.
export async function setProfile(
  distinctId: string,
  profile: Record<string, unknown>,
): Promise<void> {
  if (!MIXPANEL_TOKEN) return;
  await post(
    "engage",
    [{ $token: MIXPANEL_TOKEN, $distinct_id: distinctId, $set: profile }],
    "perfil",
  );
}
