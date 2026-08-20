"use client";

import mixpanel from "mixpanel-browser";

// Absent in dev/preview by design — only set as a Production env var in
// Vercel, mirroring how Clarity is scoped, so local/staging clicks never
// mix into real usage data.
const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

let initialized = false;

function ensureInit() {
  if (initialized) return;
  mixpanel.init(MIXPANEL_TOKEN!, { track_pageview: true, persistence: "localStorage" });
  initialized = true;
}

export function identifyOwner(ownerId: string, props: { email: string; plan: string }) {
  if (!MIXPANEL_TOKEN) return;
  ensureInit();
  mixpanel.identify(ownerId);
  mixpanel.people.set({ $email: props.email, plan: props.plan });
}

export function track(event: string, props?: Record<string, unknown>) {
  if (!MIXPANEL_TOKEN) return;
  ensureInit();
  mixpanel.track(event, props);
}
