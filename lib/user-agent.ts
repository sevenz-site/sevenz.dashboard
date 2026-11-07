// WHAT A USER-AGENT SAYS, in two words. Pure: no server-only import, so the QA suites and
// lib/security/device-text.ts can use it, and lib/mixpanel-context.ts keeps calling it.
//
// Lifted out of lib/mixpanel-context.ts on 2026-11-05 (C2 of PL-22) so the new-device alert
// names the same browser Mixpanel does. One rule, two readers.
//
// Order matters twice over. Chrome, Edge and every Chromium browser put "Safari" in their
// User-Agent, so Safari has to be tested last or it swallows all of them. And on iOS every
// browser is WebKit underneath and reports an iOS-flavoured token — CriOS for Chrome, FxiOS
// for Firefox, EdgiOS for Edge — which must be checked before the desktop names, or an
// iPhone running Chrome is filed as desktop Chrome.
export function browserOf(ua: string): string | undefined {
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

export function osOf(ua: string): string | undefined {
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  // Known blind spot, stated rather than papered over: an iPad on its default "Request
  // Desktop Website" setting sends a Macintosh User-Agent with no iPad token at all, so it
  // lands here as macOS. Only the page can tell the difference (touch points), and asking it
  // would mean shipping detection code to the browser again. iPhones — the traffic this app
  // actually has — are unaffected.
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}
