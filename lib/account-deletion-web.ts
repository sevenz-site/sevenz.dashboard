import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// THE TICKET OF «ELIMINAR TU CUENTA» FROM THE WEB (app/eliminar-cuenta, PL-48 step 1.3).
// Whoever uses that page has no session: between «send me a code» and «here it is», the
// browser carries this cookie. Same design as the sign-in ticket in
// lib/security/second-factor.ts, which documents why each part is there:
//   * SIGNED with a key derived from the service-role key (its own label, so a sign-in
//     ticket can never be replayed as this one and the other way round). An edited cookie
//     reads as no cookie at all.
//   * It carries the `ticket` that migration 193 checks: a code issued here can only be typed
//     from the browser that asked for it.
//   * `ownerId` is NULL when the email has no account. The page still says «si ese correo
//     tiene una cuenta, te llegó un código», and the code step fails with the same sentence
//     as a wrong code: the page never says whether an email is registered.
//   * `masked` is only what the screen shows. The real address is re-read from the database.

const COOKIE = "sz_delete_ticket";
const MINUTES = 15;

export type DeletionTicket = {
  ownerId: string | null;
  ticket: string;
  masked: string;
};

function key(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHash("sha256").update(`delete-account-ticket:${secret}`).digest();
}

function sign(payload: string): string | null {
  const k = key();
  return k ? createHmac("sha256", k).update(payload).digest("base64url") : null;
}

/** A ticket for an email with no account: indistinguishable from a real one on the page. */
export function decoyTicket(): string {
  return randomBytes(24).toString("base64url");
}

export async function setDeletionTicket(t: DeletionTicket): Promise<boolean> {
  const payload = Buffer.from(JSON.stringify(t)).toString("base64url");
  const sig = sign(payload);
  if (!sig) {
    console.error("[eliminar cuenta web] sin SUPABASE_SERVICE_ROLE_KEY: no se puede firmar el ticket");
    return false;
  }
  (await cookies()).set(COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/eliminar-cuenta",
    maxAge: MINUTES * 60,
  });
  return true;
}

export async function readDeletionTicket(): Promise<DeletionTicket | null> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = raw.slice(0, dot);
    const given = Buffer.from(raw.slice(dot + 1), "base64url");
    const expected = sign(payload);
    if (!expected) return null;
    const want = Buffer.from(expected, "base64url");
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DeletionTicket;
    if (!t?.ticket || typeof t.masked !== "string") return null;
    return t;
  } catch {
    return null;
  }
}

export async function clearDeletionTicket(): Promise<void> {
  (await cookies()).set(COOKIE, "", { path: "/eliminar-cuenta", maxAge: 0 });
}
