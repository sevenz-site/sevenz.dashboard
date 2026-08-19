"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { error: string | null; success: boolean };

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Ingresa tu correo.", success: false };
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  // Always report success, whether or not the email exists — otherwise this
  // form becomes a way to check which emails have a Sevenz account.
  return { error: null, success: true };
}
