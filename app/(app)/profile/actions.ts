"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validatePasswordComplexity } from "@/lib/password";

export type ProfileState = { error: string | null; success: boolean };

// Saves the logo path as soon as the file lands in storage, so uploading is
// self-contained — otherwise the file exists but nothing points at it until
// the whole profile form is submitted.
export async function updateLogo(logoPath: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { error } = await supabase
    .from("owners")
    .update({ logo_path: logoPath || null })
    .eq("id", user.id);

  if (error) return { error: `No pudimos guardar el logo: ${error.message}` };

  revalidatePath("/profile");
  return { error: null };
}

export async function deleteLogo(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data: owner } = await supabase
    .from("owners")
    .select("logo_path")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("owners").update({ logo_path: null }).eq("id", user.id);
  if (error) return { error: `No pudimos borrar el logo: ${error.message}` };

  if (owner?.logo_path) {
    await supabase.storage.from("logos").remove([owner.logo_path]);
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null };
}

// Saves the "Datos del negocio" and "Tasa de cambio" sections together —
// they used to be two separate forms with two separate save buttons, which
// read as confusing since both live under the same "Mi negocio" screen.
//
// País and the rate mode aren't user-editable right now (both render
// disabled in the form), so this always writes country back unchanged and
// always forces rate_mode to BCV_AUTO for a VE owner — there's no CUSTOM
// path to validate or read custom rate fields for anymore.
export async function updateBusinessSettings(
  _prevState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };

  const businessName = String(formData.get("business_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const taxId = String(formData.get("tax_id") ?? "").trim();
  const logoPath = String(formData.get("logo_path") ?? "").trim();
  const paymentInfo = String(formData.get("payment_info") ?? "").trim().slice(0, 500);
  const country = String(formData.get("country") ?? "CO");

  if (!businessName || !firstName || !lastName) {
    return { error: "Completa nombre del negocio, nombre y apellido.", success: false };
  }
  // Required at signup, so "Mi negocio" can't be the place it gets cleared —
  // it's the number clients reach the business on from every share link.
  if (!whatsapp) {
    return { error: "Escribe el WhatsApp del negocio.", success: false };
  }
  if (country !== "CO" && country !== "VE") {
    return { error: "País inválido.", success: false };
  }

  if (country === "VE") {
    // Doesn't touch custom_rate_usd/custom_rate_eur — if an owner has old
    // values there from before this was locked down, they stay put but are
    // inert since rate_mode is always BCV_AUTO now.
    const { error: rateError } = await supabase.from("owner_exchange_settings").upsert(
      {
        owner_id: user.id,
        rate_mode: "BCV_AUTO",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );

    if (rateError) {
      return { error: `No pudimos guardar la tasa de cambio: ${rateError.message}`, success: false };
    }
  }

  const { error } = await supabase
    .from("owners")
    .update({
      business_name: businessName,
      first_name: firstName,
      last_name: lastName,
      whatsapp,
      address: address || null,
      tax_id: taxId || null,
      logo_path: logoPath || null,
      payment_info: paymentInfo || null,
      country,
    })
    .eq("id", user.id);

  if (error) {
    return { error: `No pudimos guardar los cambios: ${error.message}`, success: false };
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

export type PasswordState = { error: string | null; success: boolean };

export async function changePassword(
  _prevState: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const supabase = await createClient();
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) {
    return { error: passwordError, success: false };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Las contraseñas no coinciden.", success: false };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    return { error: "No pudimos actualizar tu contraseña. Intenta de nuevo.", success: false };
  }

  return { error: null, success: true };
}
