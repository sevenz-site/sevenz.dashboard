"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { requireSuperadmin } from "@/lib/admin/guard";
import { trackServer } from "@/lib/mixpanel-server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCuentaSeguridad } from "@/lib/admin/security";
import { logSecurityAudit, notifyAccountChange, recentlyVerified, sendCode, verifyCode } from "@/lib/security/second-factor";
import { maskEmail, normalizeCode, rejectionText, sentToText } from "@/lib/security/code-text";

// THE ADMIN'S TWO DOORS INTO AN ACCOUNT'S ACCESS (C1 of PL-22, owner's decisions of
// 2026-11-05): resend the recovery email, and change the email of an owner whose inbox is
// dead. Each action re-runs requireSuperadmin(): these are POST endpoints, not screens.
//
// CHANGING AN EMAIL IS THE MASTER KEY. Whoever can do it owns the account: new address,
// recovery link, new password. So the screen is a checklist and the server enforces it: a
// code sent to the account's WhatsApp and typed back within the last 15 minutes, or — only
// when the account has no number — a written note of how identity was checked, kept in the
// audit. The security questions of PL-32 will join this check later.
//
// THE LINK IS NEVER SHOWN. Supabase mails it; an admin screen that displayed it would be
// the master key again, one copy-paste away.

export type AdminSecurityState = { error: string | null; notice: string | null; verified?: boolean };
const idle: AdminSecurityState = { error: null, notice: null };

const VERIFIED_WINDOW_MINUTES = 15;

export async function accionReenviarRecuperacion(_prev: AdminSecurityState, formData: FormData): Promise<AdminSecurityState> {
  const { email: actor } = await requireSuperadmin();
  const ownerId = String(formData.get("owner_id") ?? "");
  if (!ownerId) return { ...idle, error: "Falta el negocio." };
  const cuenta = await getCuentaSeguridad(ownerId);
  if (!cuenta?.email) return { ...idle, error: "No encontramos el correo de esa cuenta." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ...idle, error: "Falta la configuración de Supabase." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const bare = createBareClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await bare.auth.resetPasswordForEmail(cuenta.email, { redirectTo: `${origin}/reset-password` });
  if (error) {
    console.error("[admin] resetPasswordForEmail:", error.message);
    return { ...idle, error: "Supabase no pudo enviar el correo. Mira el tope de correos por hora." };
  }
  await logSecurityAudit(ownerId, "recovery_email_resent", actor, { to: maskEmail(cuenta.email) });
  // HOW OFTEN SUPPORT HAS TO STEP IN FOR A LOST PASSWORD. Filed under the owner.
  trackServer("Recovery Email Resent By Admin", ownerId, {}, cuenta.email);
  revalidatePath(`/admin/cuentas/${ownerId}`);
  return { error: null, notice: `Enviado a ${maskEmail(cuenta.email)}. Si no llega, está en el tope de correos por hora de Supabase.` };
}

export async function accionEnviarCodigoAdmin(_prev: AdminSecurityState, formData: FormData): Promise<AdminSecurityState> {
  await requireSuperadmin();
  const ownerId = String(formData.get("owner_id") ?? "");
  if (!ownerId) return { ...idle, error: "Falta el negocio." };
  const cuenta = await getCuentaSeguridad(ownerId);
  if (!cuenta) return { ...idle, error: "No encontramos esa cuenta." };
  if (!cuenta.whatsapp) return { ...idle, error: "La cuenta no tiene WhatsApp: comprueba la identidad por otra vía y anótala abajo." };
  const sent = await sendCode({ ownerId, email: cuenta.email, purpose: "admin_email", channel: "whatsapp", target: cuenta.whatsapp, ownerCountry: cuenta.country });
  if (!sent.ok) return { ...idle, error: rejectionText(sent.code) };
  return { error: null, notice: `${sentToText("whatsapp", sent.target).replace("Te enviamos", "Enviamos")} Pídele que te lo lea.` };
}

export async function accionVerificarCodigoAdmin(_prev: AdminSecurityState, formData: FormData): Promise<AdminSecurityState> {
  await requireSuperadmin();
  const ownerId = String(formData.get("owner_id") ?? "");
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!ownerId) return { ...idle, error: "Falta el negocio." };
  if (!code) return { ...idle, error: "Escribe los 6 dígitos que te leyó." };
  const cuenta = await getCuentaSeguridad(ownerId);
  const result = await verifyCode({ ownerId, email: cuenta?.email ?? null, purpose: "admin_email", code, ticket: null });
  if (!result.ok) return { ...idle, error: rejectionText(result.code, result.attemptsLeft), verified: false };
  return { error: null, notice: `Coincide. Tienes ${VERIFIED_WINDOW_MINUTES} minutos para cambiar el correo.`, verified: true };
}

export async function accionCambiarCorreo(_prev: AdminSecurityState, formData: FormData): Promise<AdminSecurityState> {
  const { email: actor } = await requireSuperadmin();
  const ownerId = String(formData.get("owner_id") ?? "");
  const nuevo = String(formData.get("email") ?? "").trim().toLowerCase();
  const repetido = String(formData.get("email_again") ?? "").trim().toLowerCase();
  const otraVia = String(formData.get("otra_via") ?? "").trim();
  if (!ownerId) return { ...idle, error: "Falta el negocio." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo)) return { ...idle, error: "Escribe un correo válido." };
  if (nuevo !== repetido) return { ...idle, error: "Los dos correos no coinciden." };

  const cuenta = await getCuentaSeguridad(ownerId);
  if (!cuenta) return { ...idle, error: "No encontramos esa cuenta." };
  if (cuenta.email.toLowerCase() === nuevo) return { ...idle, error: "Ese ya es el correo de la cuenta." };

  // The check the screen showed, enforced again here: the two requests are not one.
  const verified = await recentlyVerified(ownerId, "admin_email", VERIFIED_WINDOW_MINUTES);
  let verifiedBy: "whatsapp_code" | "other";
  if (verified) verifiedBy = "whatsapp_code";
  else if (!cuenta.whatsapp && otraVia.length >= 10) verifiedBy = "other";
  else if (!cuenta.whatsapp) return { ...idle, error: "La cuenta no tiene WhatsApp: escribe cómo comprobaste que es el dueño (mínimo 10 letras)." };
  else return { ...idle, error: `Primero el código al WhatsApp: tiene que coincidir en los últimos ${VERIFIED_WINDOW_MINUTES} minutos.` };

  // Auth first; if it refuses, nothing else changes. Never raw SQL on auth.users.
  const service = createServiceClient();
  const { error: authError } = await service.auth.admin.updateUserById(ownerId, { email: nuevo, email_confirm: true });
  if (authError) {
    console.error("[admin] updateUserById:", authError.message);
    const taken = /already|exists|registered/i.test(authError.message);
    return { ...idle, error: taken ? "Ese correo ya tiene una cuenta en Sevenz." : "Supabase no aceptó el correo nuevo. Mira el log." };
  }
  const { data, error } = await service.rpc("admin_set_owner_email", { p_owner_id: ownerId, p_email: nuevo, p_actor: actor });
  const r = (error ? null : data) as { ok?: boolean; code?: string } | null;
  if (error || !r?.ok) {
    // Auth already changed: say so loudly instead of pretending nothing happened.
    console.error("[admin] admin_set_owner_email:", error?.message ?? r?.code);
    return { ...idle, error: "Auth ya tiene el correo nuevo, pero la ficha del negocio no se actualizó. Avísame antes de volver a intentarlo." };
  }
  if (verifiedBy === "other") {
    await logSecurityAudit(ownerId, "email_change_identity_note", actor, { note: otraVia.slice(0, 500) });
  }
  await notifyAccountChange({
    ownerId,
    email: nuevo,
    to: cuenta.whatsapp,
    ownerCountry: cuenta.country,
    what: "email",
    newValueMasked: maskEmail(nuevo),
  });
  // HOW OFTEN AN ACCOUNT'S EMAIL HAS TO BE CHANGED BY HAND, and on what proof. If `other`
  // dominates, the WhatsApp check is not reachable for the people who need it. Filed under
  // the owner.
  trackServer("Owner Email Changed By Admin", ownerId, { verified_by: verifiedBy }, nuevo);
  revalidatePath(`/admin/cuentas/${ownerId}`);
  revalidatePath("/admin/cuentas");
  return { error: null, notice: `Listo: la cuenta entra ahora con ${maskEmail(nuevo)}. Reenvíale el correo de recuperación para que elija contraseña.` };
}
