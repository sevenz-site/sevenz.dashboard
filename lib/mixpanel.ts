"use client";

import type mixpanelBrowser from "mixpanel-browser";

// Absent in dev/preview by design — only set as a Production env var in
// Vercel, mirroring how Clarity is scoped, so local/staging clicks never
// mix into real usage data.
const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

// mixpanel-browser is 412 KB — the single largest file the app ships. It used
// to be a top-level import, which put that weight in the bundle of every
// module that touches tracking (the client list, share actions, the import
// provider, the layout), so it downloaded and parsed before a phone could
// render anything, on every signed-in screen.
//
// Now it's fetched on demand and the promise is cached, so the first caller
// pays for the network and everyone after reuses it. Nothing here is awaited
// by callers: analytics must never sit in front of what the owner is doing.
let loader: Promise<typeof mixpanelBrowser | null> | null = null;

function load(): Promise<typeof mixpanelBrowser | null> {
  if (loader) return loader;
  loader = import("mixpanel-browser")
    .then((m) => {
      const mixpanel = m.default;
      mixpanel.init(MIXPANEL_TOKEN!, { track_pageview: true, persistence: "localStorage" });
      return mixpanel;
    })
    .catch(() => {
      // A blocked or failed analytics script must not surface as an unhandled
      // rejection in the owner's console, and must not retry on every event.
      return null;
    });
  return loader;
}

export function identifyOwner(ownerId: string, props: { email: string; plan: string }) {
  if (!MIXPANEL_TOKEN) return;
  void load().then((mixpanel) => {
    if (!mixpanel) return;
    mixpanel.identify(ownerId);
    mixpanel.people.set({ $email: props.email, plan: props.plan });
  });
}

export function track(event: string, props?: Record<string, unknown>) {
  if (!MIXPANEL_TOKEN) return;
  void load().then((mixpanel) => mixpanel?.track(event, props));
}
