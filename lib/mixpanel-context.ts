import "server-only";

import { browserOf, osOf } from "@/lib/user-agent";

// Device and location for an analytics event, recovered from the request the
// browser actually made.
//
// The browser SDK used to fill these in from the page. Removing it (see
// lib/mixpanel.ts) fixed iOS dropping events, but silently took the metadata
// with it: every event since has arrived with no OS, no browser, and a country
// resolved from a Vercel server's IP rather than the owner's — not missing,
// which someone would have noticed, but plausible and wrong.
//
// Nothing here needs the client's cooperation. The browser sends its own
// User-Agent to /api/track like it does to every other route, and Vercel
// resolves geography at the edge before the request reaches us.

export type EventContext = {
  ip?: string;
  country?: string;
  $os?: string;
  $browser?: string;
};

// `browserOf` and `osOf` live in lib/user-agent.ts since 2026-11-05, so the new-device alert
// (lib/security/device-text.ts) names the browser exactly as these events do.

// x-forwarded-for is a list, client first, proxies appended left to right. The
// last entry is the hop nearest us and the least useful; taking [0] is the
// owner's address. It is spoofable in general, but here it is Vercel's edge
// that writes it, not the client.
function clientIp(h: Headers): string | undefined {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || undefined;
}

export function eventContext(h: Headers): EventContext {
  const ua = h.get("user-agent") ?? "";
  const ctx: EventContext = {};

  const ip = clientIp(h);
  // Mixpanel geolocates from whichever IP it is given, and falls back to the
  // IP that made the HTTP request — which, now that events are sent from the
  // server, is a Vercel machine. Passing the real one is what makes $city and
  // $region mean anything.
  if (ip) ctx.ip = ip;

  // Alongside Mixpanel's own IP lookup, not instead of it. This comes from
  // Vercel's edge rather than Mixpanel's database, and it is the same CO/VE
  // split the product itself runs on, so it is the value to trust if the two
  // ever disagree.
  const country = h.get("x-vercel-ip-country");
  if (country) ctx.country = country;

  if (ua) {
    const os = osOf(ua);
    const browser = browserOf(ua);
    if (os) ctx.$os = os;
    if (browser) ctx.$browser = browser;
  }

  return ctx;
}

// Exported so the two ordering rules above can be exercised directly with real
// User-Agent strings. They are the parts that are easy to get wrong and
// impossible to notice being wrong from a dashboard, where a misfiled iPhone
// just looks like a desktop visit.
export const __testables = { osOf, browserOf, clientIp };
