import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { DEVICE_COOKIE, DEVICE_COOKIE_DAYS, identityFromHeaders } from "@/lib/security/device-text";

// THE FIRST DEVICE OF AN ACCOUNT, LEARNT FROM A SESSION THAT WAS ALREADY OPEN (PL-40).
// Owner's decision of 2026-11-09: «Sí, regístralo».
//
// WHY. `recordLoginDevice` learns a device when somebody SIGNS IN, and the alert stays silent
// for the first device an account ever shows (192). The plan was that by the day the alert
// turned on «every owner's phone is already known». Measured in production on 2026-11-09,
// three days after v0.4.0: 4 owners had a device. Sessions last, so almost nobody had signed
// in again. In every other account the first sign-in, whoever made it, would have been
// recorded in silence: an intruder with the password raised no alert, and the owner got one
// later for his own phone.
//
// WHAT THIS DOES. On a page visit with a live session and no `sz_device` cookie, the browser
// gets the cookie. If the account has NO device yet, this one is recorded as its first, in
// silence, exactly as a first sign-in would be. The owner opens the app every day, so the
// window in which a stranger can be «the first» shrinks from months to hours.
//
// WHAT IT DOES NOT DO, on purpose:
//   - It never sends an alert. The words of the alert are «alguien entró a tu cuenta», and
//     nobody entered: a session was already open.
//   - It does not record a SECOND device. An account that already has one gives this browser
//     a cookie nobody knows, so its next sign-in is judged like any other (cookie unknown,
//     then place). Recording it here would let a stolen session make itself a known device,
//     and a known device skips the second factor (193).
//   - It does not close the gap entirely. If a stolen session is the first to load a page
//     after this ships, that browser becomes the first device. Same trust the first sign-in
//     already had, for a much shorter time.
//
// WHY THE COOKIE IS SET EVEN WHEN NOTHING IS RECORDED: the cookie is what stops this from
// asking the database again on every page of that browser, for ever.
//
// NO MIXPANEL EVENT, ON PURPOSE. Owner's decision of 2026-11-09 («Sí, sin evento»). The
// one question it would answer, «how many accounts are covered by the new-device alert, and
// how fast», is asked once or twice, and `owner_devices` already answers it with a read-only
// query. An event nobody looks at after the first week is a column nobody reads.
//
// READS THROUGH `owner_security_facts`, NOT THE TABLE. Table grants to the service role have
// differed between dev and production before (CLAUDE.md, 2026-09-04); the functions carry an
// explicit grant and production already calls both.

export const DEVICE_COOKIE_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

export function deviceCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: DEVICE_COOKIE_DAYS * 24 * 3600,
  };
}

/**
 * A page a person opened, not a fetch the app made on its own. One page load is one request
 * of this kind, so a browser is asked about once, not once per link on the screen.
 *
 * WHAT DECIDES IS `Accept` AND `Sec-Fetch-Dest`, NOT NEXT'S OWN HEADERS. The first version
 * also looked for `rsc` and `next-router-prefetch`, and `qa:session-device` showed the proxy
 * never sees them: Next removes its internal headers before the proxy runs. The app's
 * background requests are `fetch` calls, which ask for any type and say `Sec-Fetch-Dest: empty`;
 * a navigation asks for `text/html` and says `document`. Safari before 16.4 sends no
 * `Sec-Fetch-Dest` at all, so its absence cannot mean no.
 */
export function isPageVisit(request: { method: string; headers: { get(name: string): string | null } }): boolean {
  if (request.method !== "GET") return false;
  const h = request.headers;
  const dest = h.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  return (h.get("accept") ?? "").includes("text/html");
}

/**
 * The value to set as `sz_device` on this response, or null to leave the browser as it is
 * and ask again on its next page (the database did not answer). Never throws: this runs in
 * the proxy, in front of every screen of the app.
 */
export async function rememberSessionDevice(
  ownerId: string,
  headers: { get(name: string): string | null },
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("owner_security_facts", { p_owner_id: ownerId });
    if (error) {
      console.error("[aparato de sesión] owner_security_facts:", error.message);
      return null;
    }
    const raw = randomBytes(24).toString("base64url");
    const facts = data as { known_devices?: number } | null;
    // No `owners` row (not a shopkeeper's account), or an account that already has a device:
    // the cookie alone, nothing recorded.
    if (!facts || Number(facts.known_devices ?? 0) > 0) return raw;

    const identity = identityFromHeaders(headers);
    const { error: registerError } = await supabase.rpc("register_login_device", {
      p_owner_id: ownerId,
      p_device_hash: createHash("sha256").update(raw).digest("hex"),
      p_browser: identity.browser,
      p_country: identity.country,
      p_city: identity.city,
    });
    if (registerError) {
      console.error("[aparato de sesión] register_login_device:", registerError.message);
      return null;
    }
    return raw;
  } catch (e) {
    console.error("[aparato de sesión]:", e instanceof Error ? e.message : e);
    return null;
  }
}

export { DEVICE_COOKIE };
