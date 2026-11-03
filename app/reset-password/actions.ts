"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LEAKED_PASSWORD_MESSAGE, validatePasswordComplexity } from "@/lib/password";

export type ResetPasswordState = { error: string | null };

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) {
    return { error: passwordError };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "El link expiró o ya se usó. Solicita uno nuevo." };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "weak_password") return { error: LEAKED_PASSWORD_MESSAGE };
    return { error: "No pudimos actualizar tu contraseña. Intenta de nuevo." };
  }

  redirect("/dashboard");
}
