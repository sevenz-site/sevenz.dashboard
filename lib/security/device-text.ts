import { browserOf, osOf } from "@/lib/user-agent";
import { zonaDelNegocio } from "@/lib/format";

// THE WORDS OF THE NEW-DEVICE ALERT, AND WHAT A DEVICE IS. Pure, so qa/new-device.mjs runs
// every branch without a database or a network.
//
// C2 of PL-22, owner's decision of 2026-11-05: when someone signs in to a shopkeeper's
// account from a device Sevenz did not know, the shopkeeper gets a WhatsApp saying when,
// from what and roughly where, with one button: «No fui yo». The copy is the template
// `new_device_login_alert` in ../docs/WHATSAPP-PLANTILLAS.md, approved by the owner that day.
//
// WHAT COUNTS AS THE SAME DEVICE lives in SQL (`register_login_device`, migration 192): a
// cookie this app sets, and failing that the same country, city and browser family seen in
// the last 90 days. The 90-day fallback exists because iPhone wipes the cookie after days
// without use (PL-18 feared exactly this), and without it every entry from the same phone
// would read as a new device and the alert would be ignored within a week. What that fallback
// costs: a thief in the same city with the same kind of phone raises no alert. Stated in the
// ticket, accepted.

export const DEVICE_COOKIE = "sz_device";
export const DEVICE_COOKIE_DAYS = 400;
export const KNOWN_PLACE_DAYS = 90;
export const NOT_ME_TOKEN_HOURS = 24;

export type DeviceIdentity = {
  /** Browser family as Mixpanel names it ("Safari", "Chrome iOS"), or "otro". */
  browser: string;
  /** Operating system family, or null. Part of the wording, not of the matching rule. */
  os: string | null;
  country: string | null;
  city: string | null;
};

export function identityFromHeaders(h: { get(name: string): string | null }): DeviceIdentity {
  const ua = h.get("user-agent") ?? "";
  return {
    browser: browserOf(ua) ?? "otro",
    os: osOf(ua) ?? null,
    // Vercel resolves these at the edge from the IP; the app already trusts the country for
    // Mixpanel. The city is the carrier's, often the neighbouring one: the message says «cerca de».
    country: h.get("x-vercel-ip-country")?.trim() || null,
    city: decodeCity(h.get("x-vercel-ip-city")),
  };
}

// Vercel percent-encodes the city ("Bogot%C3%A1"). A malformed value must not throw inside
// the login action.
function decodeCity(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

const COUNTRY_NAMES: Record<string, string> = {
  VE: "Venezuela",
  CO: "Colombia",
  US: "Estados Unidos",
  ES: "España",
  MX: "México",
  PE: "Perú",
  CL: "Chile",
  AR: "Argentina",
  EC: "Ecuador",
  PA: "Panamá",
  BR: "Brasil",
};

/** «un iPhone con Safari», «un Android con Chrome», «un computador con Chrome», «un aparato». */
export function deviceText(d: Pick<DeviceIdentity, "browser" | "os">): string {
  const browser = d.browser === "otro" ? null : d.browser;
  const kind =
    d.os === "iOS" ? "un iPhone" : d.os === "Android" ? "un Android" : d.os === "Windows" || d.os === "macOS" || d.os === "Linux" ? "un computador" : "un aparato";
  return browser ? `${kind} con ${browser}` : kind;
}

/** «Barquisimeto, Venezuela», «Venezuela», or «un lugar desconocido». Never an IP. */
export function placeText(d: Pick<DeviceIdentity, "country" | "city">): string {
  const country = d.country ? (COUNTRY_NAMES[d.country.toUpperCase()] ?? d.country) : null;
  if (d.city && country) return `${d.city}, ${country}`;
  if (country) return country;
  if (d.city) return d.city;
  return "un lugar desconocido";
}

/**
 * «5 de noviembre a las 2:10 p. m.», in the business's zone, never the server's (PL-1).
 *
 * WRITTEN OUT BY HAND, NOT WITH THE APP'S `formatDateTime`. Until 2026-11-09 this returned
 * that helper's «09 de nov de 2026, 16:25», which is how a table cell reads and not how the
 * owner approved the sentence on 2026-11-05 nor the example Meta was given. Nobody had seen
 * it: the alert was switched off and no suite ran this function. Found by
 * `qa:security-alerts` the day both alerts were queued for v0.5.1; owner's decision that day
 * to match the approved copy.
 *
 * The pieces are assembled here because `Intl` writes «p. m.» with narrow and non-breaking
 * spaces that change with the ICU version, and a template parameter should not depend on
 * that. «a la 1:10», «a las 2:10»: the article follows the hour.
 */
export function whenText(iso: string, ownerCountry: string | null): string {
  const partes = new Intl.DateTimeFormat("es", {
    timeZone: zonaDelNegocio(ownerCountry),
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const hora24 = Number(parte("hour")) % 24;
  const hora12 = hora24 % 12 || 12;
  const minutos = parte("minute").padStart(2, "0");
  return `${parte("day")} de ${parte("month")} ${hora12 === 1 ? "a la" : "a las"} ${hora12}:${minutos} ${hora24 < 12 ? "a. m." : "p. m."}`;
}

/** Meta's template parameters cannot carry line breaks, tabs or more than four spaces in a row. */
export function templateSafe(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/ {5,}/g, "    ").trim();
}
