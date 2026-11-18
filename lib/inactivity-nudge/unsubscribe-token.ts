import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// THE EMAIL'S UNSUBSCRIBE LINK: `<owner id>.<HMAC of it>`.
//
// No table and no expiry, on purpose: an unsubscribe link must keep working in an email read
// months later (Gmail and Yahoo expect it), and the only thing it can do is turn the nudges
// OFF. A stolen link stops a marketing email; it cannot read or change anything else.
//
// The secret is `UNSUBSCRIBE_SECRET`, its own variable and not another key reused: rotating it
// only invalidates old unsubscribe links. Without it no nudge email is sent at all, because an
// email with no working way out is the one thing this must never send.

function secret(): string | null {
  const s = process.env.UNSUBSCRIBE_SECRET;
  return s && s.length >= 16 ? s : null;
}

function sign(ownerId: string, key: string): string {
  return createHmac("sha256", key).update(`product-tips:${ownerId}`).digest("base64url");
}

/** Null when the secret is not configured: the caller then sends no email. */
export function unsubscribeToken(ownerId: string): string | null {
  const key = secret();
  return key ? `${ownerId}.${sign(ownerId, key)}` : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner id the token was signed for, or null for anything else. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const key = secret();
  if (!key || !token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const ownerId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!UUID.test(ownerId)) return null;
  const expected = sign(ownerId, key);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return ownerId;
}
