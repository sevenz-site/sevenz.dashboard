import "server-only";

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

// Order matters twice over.
//
// Chrome, Edge and every Chromium browser put "Safari" in their User-Agent,
// so Safari has to be tested last or it swallows all of them. And on iOS every
// browser is WebKit underneath and reports an iOS-flavoured token — CriOS for
// Chrome, FxiOS for Firefox, EdgiOS for Edge — which must be checked before
// the desktop names, or an iPhone running Chrome is filed as desktop Chrome.
function browserOf(ua: string): string | undefined {
  if (/CriOS\//.test(ua)) return "Chrome iOS";
  if (/FxiOS\//.test(ua)) return "Firefox iOS";
  if (/EdgiOS\//.test(ua)) return "Edge iOS";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return undefined;
}

function osOf(ua: string): string | undefined {
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  // Known blind spot, stated rather than papered over: an iPad on its default
  // "Request Desktop Website" setting sends a Macintosh User-Agent with no
  // iPad token at all, so it lands here as macOS. Only the page can tell the
  // difference (touch points), and asking it would mean shipping detection
  // code to the browser again. iPhones — the traffic this app actually has —
  // are unaffected.
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

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
