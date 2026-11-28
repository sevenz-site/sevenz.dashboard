"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { trackServer } from "@/lib/mixpanel-server";
import { recordDeletionRequest } from "@/lib/account-deletion";
import { logSecurityAudit, sendCode, verifyCode } from "@/lib/security/second-factor";
import { normalizeCode, rejectionText, sentToText } from "@/lib/security/code-text";

// «ELIMINAR MI CUENTA» (PL-48, step 1.3; migration 227). Frames «Eliminar · 1-5» approved by
// the owner on 2026-11-20. Three steps, each re-reading the session (these are POST
// endpoints, not screens):
//   1. `startAccountDeletion` sends a six-digit code to the ACCOUNT EMAIL. Email and not
//      WhatsApp (decision written in the frames): every account has one, and it is the same
//      channel the sevenz.site page will use for owners without the app.
//   2. `confirmAccountDeletion` checks it and only then records the request, with the
//      service role: `request_account_deletion` is not granted to `authenticated`, so a
//      signed-in owner cannot skip the code.
//   3. `cancelAccountDeletion`, any time during the 30 days, with no code: it deletes nothing.
// Nothing is deleted here. The account keeps working; the deletion is run from /admin.
//
// BUSINESS QUESTION (PL-48, 2026-11-27): «¿cuántos tenderos piden borrar su cuenta, y cuántos
// se arrepienten antes de los 30 días?». If requests grow, it is a churn signal to go and ask
// why; if most are cancelled, the card is being reached by mistake and needs more friction.
// Filed under the owner, from the server: exact counts, never a floor.

export type DeletionState = {
  error: string | null;
  notice: string | null;
  step: "idle" | "sent" | "done";
};

const idle: DeletionState = { error: null, notice: null, step: "idle" };

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function startAccountDeletion(): Promise<DeletionState> {
  const { user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  if (!user.email) return { ...idle, error: "Tu cuenta no tiene correo. Escríbenos desde Soporte en sevenz.site." };
  const sent = await sendCode({
    ownerId: user.id,
    email: user.email,
    purpose: "delete_account",
    channel: "email",
    target: user.email,
  });
  if (!sent.ok) return { ...idle, error: rejectionText(sent.code) };
  return { error: null, notice: sentToText("email", sent.target), step: "sent" };
}

export async function confirmAccountDeletion(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const { user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Escribe los 6 dígitos del código.", notice: null, step: "sent" };

  const result = await verifyCode({ ownerId: user.id, email: user.email ?? null, purpose: "delete_account", code, ticket: null });
  if (!result.ok) {
    // An expired code is not replaced by itself here: «Reenviar código» does it, so the
    // sentence must not promise a new one (the same choice as turning the factor on).
    const step = result.code === "none" || result.code === "locked" ? "idle" : "sent";
    return { error: rejectionText(result.code === "expired" ? "none" : result.code, result.attemptsLeft), notice: null, step };
  }

  const recorded = await recordDeletionRequest({ ownerId: user.id, email: user.email ?? null, source: "app" });
  if (!recorded.ok) {
    return { error: "No pudimos registrar tu pedido. Inténtalo de nuevo.", notice: null, step: "sent" };
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null, notice: `Listo. Tu cuenta se eliminará el ${recorded.date}.`, step: "done" };
}

export async function cancelAccountDeletion(): Promise<DeletionState> {
  const { supabase, user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const { data, error } = await supabase.rpc("cancel_my_account_deletion");
  if (error) {
    console.error("[eliminar cuenta] cancel_my_account_deletion:", error.message);
    return { ...idle, error: "No pudimos cancelarlo. Inténtalo de nuevo." };
  }
  if (data === true) {
    await logSecurityAudit(user.id, "account_deletion_cancelled", "owner", {});
    trackServer("Account Deletion Cancelled", user.id, {}, user.email);
  }
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null, notice: "Listo, tu cuenta ya no se eliminará.", step: "done" };
}
