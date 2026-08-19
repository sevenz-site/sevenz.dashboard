"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error: string | null };

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (newPassword.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
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
    return { error: "No pudimos actualizar tu contraseña. Intenta de nuevo." };
  }

  redirect("/dashboard");
}
