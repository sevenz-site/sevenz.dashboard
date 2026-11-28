"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { recordDeletionRequest } from "@/lib/account-deletion";
import { clearDeletionTicket, decoyTicket, readDeletionTicket, setDeletionTicket } from "@/lib/account-deletion-web";
import { sendCode, verifyCode } from "@/lib/security/second-factor";
import { maskEmail, normalizeCode } from "@/lib/security/code-text";

// «ELIMINAR TU CUENTA» WITHOUT THE APP (PL-48 step 1.3). Google requires a web page to ask for
// it. Owner's decision of 2026-11-28: a CODE to the account email, never a link («un código
// sin enlace»), the same rule as every account email since 2026-11-05.
//
// UNAUTHENTICATED BY DESIGN, so (CLAUDE.md, «Mask raw errors on unauthenticated endpoints"):
//   * THE SAME ANSWER WHETHER THE EMAIL HAS AN ACCOUNT OR NOT. Step 1 always moves to the code
//     step with «si ese correo tiene una cuenta, te llegó un código»; with no account, the
//     ticket is a decoy and the code step fails with the same sentence as a wrong code. This
//     page must not tell anyone which emails are registered in Sevenz.
//   * Fixed sentences only; the real error goes to the server log.
//   * The cap is the code's own (migration 193): six per email per hour.
// Known and accepted: the step with an account does a little more work (create the code,
// send the email), so it answers a little later than one without. Masking that would need
// the send to happen after the response, and a failed send could then never be shown.
//
// Nothing is recorded until the code is typed. The request then goes through the same
// `recordDeletionRequest` as Mi negocio, with `source: "web"`.

export type WebDeletionState = {
  step: "email" | "code" | "done";
  error: string | null;
  masked: string | null;
  date: string | null;
};

const GENERIC_CODE_ERROR = "Ese código no es correcto o ya venció. Revisa el correo o pide uno nuevo.";

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

async function ownerByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const { data, error } = await createServiceClient().from("owners").select("id, email").eq("email", email).maybeSingle();
  if (error) {
    console.error("[eliminar cuenta web] owners:", error.message);
    return null;
  }
  return data?.id && data.email ? { id: data.id, email: data.email } : null;
}

export async function requestWebDeletionCode(_prev: WebDeletionState, formData: FormData): Promise<WebDeletionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return { step: "email", error: "Escribe un correo válido.", masked: null, date: null };

  const masked = maskEmail(email);
  const owner = await ownerByEmail(email);
  let ticket = decoyTicket();
  let ownerId: string | null = null;
  if (owner) {
    const sent = await sendCode({ ownerId: owner.id, email: owner.email, purpose: "delete_account", channel: "email", target: owner.email, withTicket: true });
    if (sent.ok) {
      ticket = sent.ticket;
      ownerId = owner.id;
    } else {
      // Too many codes this hour, or the send failed. Said the same way as «no account»: the
      // next step fails generically, and the owner can try again later.
      console.error("[eliminar cuenta web] sendCode:", sent.code);
    }
  }
  if (!(await setDeletionTicket({ ownerId, ticket, masked }))) {
    return { step: "email", error: "No pudimos continuar. Inténtalo en unos minutos.", masked: null, date: null };
  }
  return { step: "code", error: null, masked, date: null };
}

export async function confirmWebDeletion(_prev: WebDeletionState, formData: FormData): Promise<WebDeletionState> {
  const t = await readDeletionTicket();
  if (!t) return { step: "email", error: "Pasó demasiado tiempo. Escribe tu correo otra vez.", masked: null, date: null };
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { step: "code", error: "Escribe los 6 dígitos del código.", masked: t.masked, date: null };
  if (!t.ownerId) return { step: "code", error: GENERIC_CODE_ERROR, masked: t.masked, date: null };

  const { data: owner } = await createServiceClient().from("owners").select("email").eq("id", t.ownerId).maybeSingle();
  const result = await verifyCode({ ownerId: t.ownerId, email: owner?.email ?? null, purpose: "delete_account", code, ticket: t.ticket });
  if (!result.ok) return { step: "code", error: GENERIC_CODE_ERROR, masked: t.masked, date: null };

  const recorded = await recordDeletionRequest({ ownerId: t.ownerId, email: owner?.email ?? null, source: "web" });
  if (!recorded.ok) return { step: "code", error: "No pudimos registrar tu pedido. Inténtalo de nuevo.", masked: t.masked, date: null };
  await clearDeletionTicket();
  return { step: "done", error: null, masked: t.masked, date: recorded.date };
}
