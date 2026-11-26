// THE CATALOGUE'S EXTRA LINK AND ITS WHATSAPP BUTTON (migration 225).
//
// Owner's request of 2026-11-26, frames `2291:25034`: one extra link in the catalogue's
// header, its text chosen from a list -- «Sitio web», «Instagram», «Facebook», «TikTok» --
// with its icon, never typed by the owner.
//
// WHY THE HOST MUST MATCH THE LABEL, which is the part that matters. The welcome message
// takes no links (owner's decision of 2026-11-12) because a link on a page under Sevenz's
// domain reads as one Sevenz vouches for, and «pay here» with a link is the scam every
// WhatsApp footer of this product warns about. A button that says «Instagram» hides where
// it goes, so «Instagram» must go to instagram.com: otherwise the label is the disguise.
// Shorteners hide the destination the same way and are refused for every kind, and so are
// WhatsApp links, which would let a page point at a number that is not the business's.
//
// Shared by the owner's screen (error as he types), the server action (checks again: the
// browser is never trusted with what is published) and the public page (checks a third
// time before drawing, so an old or hand-edited row draws nothing instead of a bad link).
//
// NO IMPORTS, on purpose: `qa/catalogo-marca.mjs` loads this with Node's type stripping,
// which cannot follow an extensionless import (the same reason as `welcome.ts`).

export const LINK_KINDS = ["website", "instagram", "facebook", "tiktok"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

// The order the owner listed them in, which is also the order of the selector.
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  website: "Sitio web",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export const LINK_KIND_PLACEHOLDER: Record<LinkKind, string> = {
  website: "https://tunegocio.com",
  instagram: "https://instagram.com/tunegocio",
  facebook: "https://facebook.com/tunegocio",
  tiktok: "https://tiktok.com/@tunegocio",
};

export const LINK_MAX = 300;

// The hosts each network answers on. A subdomain counts (`www.`, `m.`, `vm.tiktok.com`);
// a look-alike does not (`instagram.com.evil.net` ends in `evil.net`).
const NETWORK_HOSTS: Record<Exclude<LinkKind, "website">, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  tiktok: ["tiktok.com"],
};

// What the owner is told to paste, in the wrong-network error.
const NETWORK_EXAMPLE: Record<Exclude<LinkKind, "website">, string> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  tiktok: "https://tiktok.com/",
};

const SHORTENERS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly",
  "rebrand.ly", "shorturl.at", "tiny.cc", "rb.gy", "s.id", "t.ly", "v.gd", "short.io",
  "bl.ink", "lnkd.in",
];

const WHATSAPP_HOSTS = ["wa.me", "whatsapp.com", "wa.link"];

export type LinkRejectReason =
  | "link_kind_missing"
  | "link_too_long"
  | "link_not_https"
  | "link_invalid"
  | "link_shortener"
  | "link_whatsapp"
  | "link_wrong_network";

export type LinkCheck =
  | { ok: true; kind: LinkKind | null; url: string | null }
  | { ok: false; reason: LinkRejectReason; error: string };

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === "string" && (LINK_KINDS as readonly string[]).includes(value);
}

function hostIs(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// An empty URL means «no link», whatever the selector says: the owner who clears the field
// is removing the button, and a label with nothing behind it is stored as nothing.
export function checkExtraLink(kind: string | null | undefined, raw: string | null | undefined): LinkCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, kind: null, url: null };
  if (!isLinkKind(kind)) {
    return { ok: false, reason: "link_kind_missing", error: "Elige qué enlace es." };
  }
  if (text.length > LINK_MAX) {
    return { ok: false, reason: "link_too_long", error: `El enlace puede tener hasta ${LINK_MAX} caracteres.` };
  }
  if (!/^https:\/\//i.test(text)) {
    return { ok: false, reason: "link_not_https", error: "Escribe el enlace completo, empezando con https://" };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "link_invalid", error: "Ese enlace no se entiende. Revísalo." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // `https://instagram.com@evil.net` parses with `evil.net` as the host; a user or password
  // in a link the customer taps has no honest use, so it is refused outright.
  if (/\s/.test(text) || url.protocol !== "https:" || url.username || url.password || !host.includes(".")) {
    return { ok: false, reason: "link_invalid", error: "Ese enlace no se entiende. Revísalo." };
  }
  if (hostIs(host, SHORTENERS)) {
    return { ok: false, reason: "link_shortener", error: "No se aceptan enlaces acortados. Pega el enlace completo." };
  }
  if (hostIs(host, WHATSAPP_HOSTS)) {
    return {
      ok: false,
      reason: "link_whatsapp",
      error: "Para WhatsApp usa la casilla «Mostrar «Contactar vía WhatsApp» en mi catálogo».",
    };
  }
  if (kind !== "website" && !hostIs(host, NETWORK_HOSTS[kind])) {
    return {
      ok: false,
      reason: "link_wrong_network",
      error: `Ese enlace no es de ${LINK_KIND_LABEL[kind]}. Pega el de tu perfil, que empieza con ${NETWORK_EXAMPLE[kind]}`,
    };
  }
  return { ok: true, kind, url: url.toString() };
}

// THE GREETING WhatsApp opens with. Owner's answer of 2026-11-26: «Con un saludo ya
// escrito». The words are mine, in the neutral in-app tone of the brand voice: they are
// the customer's words to the business, sent from the customer's phone, read in Venezuela
// and Colombia alike. They do not name Sevenz: «vi tu catálogo» already tells the owner
// where the customer came from. The customer can change it before sending.
export const CATALOG_WHATSAPP_GREETING = "Hola, vi tu catálogo y quiero hacerte una consulta.";

// `wa.me` takes the number with its country code and digits only. A number stored without
// its code opens the wrong chat, and nothing is prepended to fix it: adding a code we were
// not given is inventing a stranger's number (the same rule as the order screen).
export function catalogWhatsappHref(whatsapp: string | null | undefined): string | null {
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(CATALOG_WHATSAPP_GREETING)}`;
}
