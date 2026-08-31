"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePasswordComplexity } from "@/lib/password";

export type SignupFieldValues = {
  business_name: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  country: string;
  email: string;
};

export type SignupState = {
  error: string | null;
  success: boolean;
  alreadyRegistered?: boolean;
  // Echoed back on every failure so the form can restore what the owner
  // already typed. Deliberately excludes password/confirm_password — a
  // slow connection can mean the tap lands before this page's JS finishes
  // hydrating, so the browser falls back to a real (non-AJAX) form POST,
  // which reloads the page and wipes every field's in-memory value. That
  // reload is otherwise invisible to the visitor; the only fix is having
  // the server hand the values back so the fresh render can restore them.
  values?: SignupFieldValues;
};

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const businessName = String(formData.get("business_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const country = String(formData.get("country") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const acceptedTerms = formData.get("accepted_terms") === "on";

  const values: SignupFieldValues = {
    business_name: businessName,
    first_name: firstName,
    last_name: lastName,
    whatsapp,
    country,
    email,
  };

  if (!businessName || !firstName || !lastName || !whatsapp || !email || !password) {
    return { error: "Completa todos los campos.", success: false, values };
  }
  if (country !== "CO" && country !== "VE") {
    return { error: "Selecciona un país válido.", success: false, values };
  }
  // Matches the password policy set in Supabase Auth (Sign In / Providers →
  // Email → "Password requirements") — checked here too so a mismatch is a
  // friendly Spanish message instead of Supabase's own raw rejection.
  const passwordError = validatePasswordComplexity(password);
  if (passwordError) {
    return { error: passwordError, success: false, values };
  }
  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden.", success: false, values };
  }
  // Re-checked here even though the form disables submit until this is
  // checked — a raw POST to this action must not be able to skip it.
  if (!acceptedTerms) {
    return { error: "Debes aceptar los Términos y condiciones.", success: false, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        business_name: businessName,
        first_name: firstName,
        last_name: lastName,
        whatsapp: whatsapp || null,
        country,
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true, values };
    }
    // Supabase's leaked-password check (HaveIBeenPwned) rejects this at the
    // API level, after our own validatePasswordComplexity already passed —
    // it's a different check (breach-database lookup, not complexity
    // rules), so it needs its own Spanish message rather than falling
    // through to the raw-English fallback below. error.code is the stable
    // identifier Supabase docs recommend checking, not the message text.
    if (error.code === "weak_password") {
      return {
        error: "Esa contraseña es muy común o ha aparecido en filtraciones de datos conocidas — elige una diferente.",
        success: false,
        values,
      };
    }
    // Surfaced directly (not a generic fallback) so a real Supabase error —
    // e.g. an email rate limit from repeated test signups, or a rejected
    // domain — is visible without needing server log access.
    console.error("[signup] supabase.auth.signUp failed:", error.message);
    return { error: `No pudimos crear tu cuenta: ${error.message}`, success: false, values };
  }

  // Supabase returns no error for a duplicate email when email confirmation is
  // required (to avoid leaking which emails are registered) — it just skips
  // creating a new identity. That's the only signal we get, so check for it.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true, values };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return { error: null, success: true };
}
