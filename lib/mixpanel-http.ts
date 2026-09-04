import "server-only";

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

// `source` distinguishes an event raised inside a server action from one a
// browser posted to the proxy, so a future drop in "browser" events is
// visible in Mixpanel itself rather than having to be inferred.
export async function sendEvent(
  event: string,
  distinctId: string,
  props: Record<string, unknown> | undefined,
  source: "server" | "browser",
  profile?: Record<string, unknown>,
): Promise<void> {
  if (!MIXPANEL_TOKEN) return;
  await post(
    "track",
    [
      {
        event,
        properties: {
          token: MIXPANEL_TOKEN,
          distinct_id: distinctId,
          time: Date.now(),
          // Makes the event idempotent: if this ever gets retried, Mixpanel
          // discards the duplicate instead of double-counting.
          $insert_id: crypto.randomUUID(),
          source,
          ...props,
          ...(profile ? { $set: profile } : {}),
        },
      },
    ],
    `"${event}"`,
  );
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
