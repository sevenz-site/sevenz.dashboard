// THE CATALOGUE LINK CHANGES WHEN THE LOGO CHANGES (owner's go-ahead of 2026-11-25, «Sí,
// hazlo»).
//
// WhatsApp keeps the card of each link it has seen, on its side, and a business's catalogue
// link was always the same: a shopkeeper who uploaded his logo after sharing it kept getting the
// old card, Sevenz's, with nothing here able to expire it. So the shared link carries `?v=` and
// a short tag of the logo's file: a new logo is a new link, which WhatsApp reads again. The
// page ignores the parameter, so every link already sent keeps working.
//
// The logo's FILE PATH, not a date: an upload writes a new file name (`logo-<ms>.<ext>`), so
// the tag moves with the logo and only with it. With no logo there is no tag, and the link is
// the plain one it always was. The image's own address carries the same tag, for a chat app that
// keeps images by address too.

/** A short tag of the logo's file; null without one. FNV-1a, 32 bits, in base 36. */
export function logoVersion(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < logoPath.length; i++) {
    hash ^= logoPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** `path`, plus `?v=` when the business has a logo. */
export function withLogoVersion(path: string, logoPath: string | null | undefined): string {
  const v = logoVersion(logoPath);
  return v ? `${path}${path.includes("?") ? "&" : "?"}v=${v}` : path;
}
