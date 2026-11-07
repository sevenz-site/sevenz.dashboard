"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { LEAKED_PASSWORD_MESSAGE, validatePasswordComplexity } from "@/lib/password";
import { logSecurityAudit } from "@/lib/security/second-factor";

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

  // A new password is what «No fui yo» was waiting for (C2 of PL-22): the mark that kept the
  // app closed comes off here and nowhere else. Service role, because no session may clear it.
  try {
    const { error: clearError } = await createServiceClient().rpc("clear_must_reset_password", { p_owner_id: user.id });
    if (clearError) console.error("[reset] clear_must_reset_password:", clearError.message);
  } catch (e) {
    console.error("[reset] clear_must_reset_password:", e instanceof Error ? e.message : e);
  }

  // The history of /admin shows this one too (the owner's decision of 2026-11-07). A
  // failure here must not cost the owner a password already changed.
  try {
    await logSecurityAudit(user.id, "password_changed_by_link", "owner", {});
  } catch (e) {
    console.error("[reset] audit:", e instanceof Error ? e.message : e);
  }

  redirect("/dashboard");
}
