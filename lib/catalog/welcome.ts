// THE CATALOGUE'S WELCOME MESSAGE (CT-170, phase 1). Owner's decision of 2026-11-12:
// «máximo 140 caracteres, solo texto, sin enlaces».
//
// WHY NO LINKS, which is the part that matters: the message is published on a page under
// Sevenz's own domain that anyone can open without an account. A link there is a link
// Sevenz appears to vouch for, and «pay here» with a link is exactly the scam this product
// already defends against in every WhatsApp footer. So a message with something that looks
// like an address is refused, not cleaned: removing it silently would publish a sentence
// the owner did not write.
//
// ONE PARAGRAPH. Line breaks and runs of spaces collapse into one space: the frame draws a
// single centred paragraph, and a message of blank lines would push the products down.
//
// Shared by the owner's screen (counter and error as he types) and the server action,
// which checks again: the browser is never trusted with what is published.

export const WELCOME_MAX = 140;

// Anything a reader could tap or copy into a browser: a scheme, `www.`, a WhatsApp
// shortcut, or a word followed by a dot and a common ending. The endings are listed and
// not «any letters» on purpose: «etc.lunes» or «Sr.Pérez» must not be refused.
const LINK =
  /(https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(com|net|org|info|biz|ve|co|io|me|ly|app|site|shop|store|online|link|xyz|tk|ml|gl|gg|to)\b)/i;

export type WelcomeCheck = { ok: true; text: string | null } | { ok: false; error: string };

export function normalizeWelcome(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

export function checkWelcome(input: string | null | undefined): WelcomeCheck {
  const text = normalizeWelcome(input);
  if (!text) return { ok: true, text: null };
  if ([...text].length > WELCOME_MAX) {
    return { ok: false, error: `El mensaje puede tener hasta ${WELCOME_MAX} caracteres.` };
  }
  if (LINK.test(text)) {
    return { ok: false, error: "El mensaje no puede llevar enlaces ni direcciones web." };
  }
  return { ok: true, text };
}
