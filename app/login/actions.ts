"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  // HOW MANY COME BACK, and how many who signed up ever reach the app. Filed under the
  // owner.
  if (data.user) trackServer("Login Completed", data.user.id, {}, data.user.email);

  redirect("/dashboard");
}
