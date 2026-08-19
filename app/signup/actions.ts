"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignupState = { error: string | null; success: boolean; alreadyRegistered?: boolean };

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const businessName = String(formData.get("business_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!businessName || !firstName || !lastName || !whatsapp || !email || !password) {
    return { error: "Completa todos los campos.", success: false };
  }
  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres.", success: false };
  }
  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden.", success: false };
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
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true };
    }
    return { error: "No pudimos crear tu cuenta. Intenta de nuevo.", success: false };
  }

  // Supabase returns no error for a duplicate email when email confirmation is
  // required (to avoid leaking which emails are registered) — it just skips
  // creating a new identity. That's the only signal we get, so check for it.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return { error: null, success: true };
}
