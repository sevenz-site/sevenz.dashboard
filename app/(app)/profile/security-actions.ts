"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { trackServer } from "@/lib/mixpanel-server";
import {
  logSecurityAudit,
  maskedTarget,
  notifyAccountChange,
  securityFacts,
  sendCode,
  setSecondFactor,
  verifyCode,
  verifyPassword,
} from "@/lib/security/second-factor";
import { maskPhone, normalizeCode, rejectionText, sentToText } from "@/lib/security/code-text";

// «SEGURIDAD DE LA CUENTA» (C1 of PL-22): turning the factor on and off, and changing the
// WhatsApp number. Owner's decisions of 2026-11-05:
//   * activating completes only when a TEST CODE sent to the number was typed back — a
//     mistyped number must not lock somebody out at their next sign-in;
//   * turning it off, and changing the number, ask for the PASSWORD: a thief with an open
//     session has none;
//   * a new number is proved with a code before it is saved, and the OLD number is told.
// Every action re-reads the session: these are POST endpoints, not screens.

export type SecurityState = {
  error: string | null;
  notice: string | null;
  // The step the dialog is at: 'sent' once a code is out, 'done' when the action finished.
  step: "idle" | "sent" | "done";
};

const idle: SecurityState = { error: null, notice: null, step: "idle" };

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── Turning the factor on ──────────────────────────────────────────────────

export async function startSecondFactorEnable(): Promise<SecurityState> {
  const { user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const facts = await securityFacts(user.id);
  if (!facts) return { ...idle, error: "No pudimos leer tu cuenta. Inténtalo de nuevo." };
  if (facts.secondFactor) return { ...idle, step: "done", notice: "La verificación en dos pasos ya está activa." };
  if (!facts.whatsapp) {
    return { ...idle, error: "Primero agrega el WhatsApp de tu cuenta, más arriba en esta pantalla." };
  }
  const sent = await sendCode({ ownerId: user.id, email: user.email ?? null, purpose: "enable", channel: "whatsapp", target: facts.whatsapp, ownerCountry: facts.ownerCountry });
  if (!sent.ok) return { ...idle, error: rejectionText(sent.code) };
  return { error: null, notice: sentToText("whatsapp", sent.target), step: "sent" };
}

export async function confirmSecondFactorEnable(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const { user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Escribe los 6 dígitos del código.", notice: null, step: "sent" };

  const result = await verifyCode({ ownerId: user.id, email: user.email ?? null, purpose: "enable", code, ticket: null });
  if (!result.ok) {
    // An expired test code is not replaced by itself here: the dialog's «Reenviar» does it.
    const step = result.code === "none" || result.code === "locked" ? "idle" : "sent";
    return { error: rejectionText(result.code === "expired" ? "none" : result.code, result.attemptsLeft), notice: null, step };
  }
  if (!(await setSecondFactor(user.id, true))) return { error: "No pudimos activarla. Inténtalo de nuevo.", notice: null, step: "sent" };
  await logSecurityAudit(user.id, "second_factor_enabled", "owner", { channel: "whatsapp", target: maskPhone(result.target) });
  // DOES ANYBODY TURN THE OPTIONAL FACTOR ON, and from where? Filed under the owner.
  trackServer("Second Factor Enabled", user.id, {}, user.email);
  revalidatePath("/profile");
  return { error: null, notice: "Listo: desde ahora, al entrar desde un aparato nuevo te pediremos un código.", step: "done" };
}

export async function disableSecondFactor(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const { user } = await sessionUser();
  if (!user?.email) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const password = String(formData.get("password") ?? "");
  const check = await verifyPassword(user.id, user.email, password);
  if (check === "wrong") return { ...idle, error: "La contraseña no es correcta." };
  if (check === "too_many") return { ...idle, error: "Demasiados intentos. Espera 15 minutos." };
  if (check === "error") return { ...idle, error: "No pudimos comprobar tu contraseña. Inténtalo de nuevo." };
  if (!(await setSecondFactor(user.id, false))) return { ...idle, error: "No pudimos desactivarla. Inténtalo de nuevo." };
  await logSecurityAudit(user.id, "second_factor_disabled", "owner", {});
  trackServer("Second Factor Disabled", user.id, {}, user.email);
  revalidatePath("/profile");
  return { error: null, notice: "La verificación en dos pasos quedó desactivada.", step: "done" };
}

// ── Changing the WhatsApp number ───────────────────────────────────────────

const PHONE = /^\d{8,15}$/;

export async function startNumberChange(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const { user } = await sessionUser();
  if (!user?.email) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const password = String(formData.get("password") ?? "");
  const number = String(formData.get("whatsapp") ?? "").replace(/\D/g, "");
  if (!PHONE.test(number)) return { ...idle, error: "Escribe un número de WhatsApp válido, con el código del país." };

  const facts = await securityFacts(user.id);
  if (!facts) return { ...idle, error: "No pudimos leer tu cuenta. Inténtalo de nuevo." };
  if (facts.whatsapp === number) return { ...idle, error: "Ese ya es el número de tu cuenta." };

  const check = await verifyPassword(user.id, user.email, password);
  if (check === "wrong") return { ...idle, error: "La contraseña no es correcta." };
  if (check === "too_many") return { ...idle, error: "Demasiados intentos. Espera 15 minutos." };
  if (check === "error") return { ...idle, error: "No pudimos comprobar tu contraseña. Inténtalo de nuevo." };

  // The code goes to the NEW number: that is what proves it is reachable and his.
  const sent = await sendCode({ ownerId: user.id, email: user.email, purpose: "number", channel: "whatsapp", target: number, ownerCountry: facts.ownerCountry });
  if (!sent.ok) return { ...idle, error: rejectionText(sent.code) };
  return { error: null, notice: `${sentToText("whatsapp", number)} Escríbelo aquí para guardar el número.`, step: "sent" };
}

export async function confirmNumberChange(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const { supabase, user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Escribe los 6 dígitos del código.", notice: null, step: "sent" };

  const result = await verifyCode({ ownerId: user.id, email: user.email ?? null, purpose: "number", code, ticket: null });
  if (!result.ok) {
    const step = result.code === "none" || result.code === "locked" || result.code === "expired" ? "idle" : "sent";
    return { error: rejectionText(result.code === "expired" ? "none" : result.code, result.attemptsLeft), notice: null, step };
  }

  // The number saved is the one the code went to (from the database), never the form's.
  const facts = await securityFacts(user.id);
  const previous = facts?.whatsapp ?? null;
  const { error } = await supabase.from("owners").update({ whatsapp: result.target }).eq("id", user.id);
  if (error) {
    console.error("[cambio de número]:", error.message);
    return { error: "No pudimos guardar el número. Inténtalo de nuevo.", notice: null, step: "idle" };
  }
  await logSecurityAudit(user.id, "whatsapp_changed", "owner", { from: maskPhone(previous), to: maskPhone(result.target) });
  await notifyAccountChange({
    ownerId: user.id,
    email: user.email ?? null,
    to: previous,
    ownerCountry: facts?.ownerCountry ?? null,
    what: "number",
    newValueMasked: maskedTarget("whatsapp", result.target),
  });
  // HOW OFTEN THE NUMBER CHANGES, and whether a «No fui yo» ever follows. Filed under the owner.
  trackServer("WhatsApp Number Changed", user.id, { had_number: Boolean(previous) }, user.email);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null, notice: "Número guardado.", step: "done" };
}

// ── The code before a password change, when the factor is on ───────────────

export async function startPasswordChangeCode(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  const { user } = await sessionUser();
  if (!user) return { ...idle, error: "Sesión expirada, vuelve a entrar." };
  const facts = await securityFacts(user.id);
  if (!facts) return { ...idle, error: "No pudimos leer tu cuenta. Inténtalo de nuevo." };
  if (!facts.secondFactor) return { ...idle, step: "sent", notice: null };
  const toEmail = String(formData.get("channel") ?? "") === "email" || !facts.whatsapp;
  const channel = toEmail ? "email" : "whatsapp";
  const sent = await sendCode({ ownerId: user.id, email: user.email ?? null, purpose: "password", channel, target: channel === "whatsapp" ? facts.whatsapp : facts.email, ownerCountry: facts.ownerCountry });
  if (!sent.ok) return { ...idle, error: rejectionText(sent.code) };
  return { error: null, notice: sentToText(sent.channel, sent.target), step: "sent" };
}
