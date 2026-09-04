"use client";

// Browser-side analytics, posted to this app's own /api/track rather than to
// Mixpanel directly.
//
// This used to load mixpanel-browser and call api.mixpanel.com from the page.
// That silently lost every event on iOS Safari — which is most of this app's
// traffic — because tracking protection and content blockers drop requests to
// known analytics hosts. The code looked correct and the events simply never
// arrived: "Client Details Opened", "Share Link Opened", the import events and
// the owner's own profile were all invisible for iPhone owners, while the
// money-path events (sent from server actions) came through fine and made the
// gap look like a usage pattern rather than a bug.
//
// Posting to the app's own origin is indistinguishable from ordinary app
// traffic, so there is nothing for a blocker to single out. It also drops the
// 412 KB mixpanel-browser bundle, which was the largest asset here.
//
// The call signatures are unchanged, so every existing track() site still
// works — see CLAUDE.md's iPhone rule: if it matters, the server does it.

const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

function post(body: Record<string, unknown>) {
  if (!MIXPANEL_TOKEN) return;
  try {
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Without this the browser cancels the request when the click that
      // raised it also navigates away — which is exactly when "Client Details
      // Opened" and "Share Link Opened" fire. keepalive lets it outlive the
      // page. (Payloads are capped at 64 KB under keepalive; the route caps
      // props well below that.)
      keepalive: true,
    }).catch(() => {
      // A failed analytics call must never surface in the owner's console or
      // as an unhandled rejection.
    });
  } catch {
    // Ignored for the same reason.
  }
}

// distinct_id is resolved server-side from the session, so the owner id is not
// sent from here — it cannot be trusted from the browser and the route ignores
// it. The argument stays for call-site compatibility.
export function identifyOwner(_ownerId: string, props: { email: string; plan: string }) {
  post({ profile: { $email: props.email, plan: props.plan } });
}

export function track(event: string, props?: Record<string, unknown>) {
  post({ event, props });
}
