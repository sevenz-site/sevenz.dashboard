"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { mustResetPassword, recordLoginDevice } from "@/lib/security/new-device";

export type AuthState = { error: string | null; email?: string };

export async function login(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y contraseña.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Correo o contraseña incorrectos.", email };
  }

  // AFTER «NO FUI YO» THE OLD PASSWORD OPENS NOTHING (C2 of PL-22). The account is marked
  // until a new password is set through the reset email, so the thief who knows the old one
  // is kept out, and the owner gets the email again right here in case the first was lost.
  if (data.user && (await mustResetPassword(supabase))) {
    await supabase.auth.signOut({ scope: "local" });
    try {
      const h = await headers();
      const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
    } catch (e) {
      console.error("[login] reset email:", e instanceof Error ? e.message : e);
    }
    trackServer("Login Blocked Pending Reset", data.user.id, {}, data.user.email);
    return {
      error: "Por seguridad, elige una contraseña nueva: te enviamos un enlace a tu correo.",
      email,
    };
  }

  // Which device this is, and the WhatsApp alert if it is a new one. Never fails the sign-in.
  const device = data.user ? await recordLoginDevice({ id: data.user.id, email: data.user.email ?? null }) : null;

  // HOW MANY COME BACK, and how many who signed up ever reach the app. Filed under the
  // owner. `new_device` says whether this sign-in came from a device Sevenz did not know.
  if (data.user) trackServer("Login Completed", data.user.id, { new_device: device?.isNew ?? false }, data.user.email);

  redirect("/dashboard");
}
