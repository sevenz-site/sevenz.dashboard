"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LEAKED_PASSWORD_MESSAGE, validatePasswordComplexity } from "@/lib/password";
import { mensajeDeError } from "@/lib/errores-legibles";
import { storageFileExists } from "@/lib/storage-file-exists";

export type ProfileState = { error: string | null; success: boolean };

// Las columnas que solo cambia Sevenz —el plan de la cuenta y el país— están
// protegidas por un trigger en la base (migraciones 055 y 056). Si alguna vez
// salta, el texto que devuelve Postgres NO puede acabar en la pantalla del
// tendero: es el fallo del plazo de pago de anteayer otra vez, cuando la 054
// le devolvió "violates check constraint movements_plazo_dias_check" a alguien
// que solo quería fiar.
//
// Hoy no salta nunca: este formulario manda el país que ya tiene, así que no
// cambia nada. El caso vive desde el 2026-10-01 en `lib/errores-legibles.ts`,
// con el resto: tenerlo aquí además era la MISMA frase escrita dos veces, y de
// esas dos una acaba quedándose vieja.
function mensajeDeGuardado(error: unknown): string {
  return mensajeDeError("guardar los cambios", error, "profile");
}

// A logo path must name a file inside the owner's own folder of the `logos`
// bucket — the shape LogoUploader has written since 2026-08-19
// (`<ownerId>/logo-<ts>.jpg`).
//
// Finding 10 of the 2026-11-02 audit: both doors that write `logo_path` stored
// whatever the browser sent, so an owner could point their logo at another
// business's file and show it on their own links and receipts. Storage
// policies stop uploading or deleting in someone else's folder; they say
// nothing about pointing at it, so the check lives here.
//
// A bare `startsWith` is NOT enough: `<ownerId>/../<otherId>/logo.png` passes
// it, and the browser normalises `..` when it builds the public URL in
// `getPublicLogoUrl`. Hence a single file-name segment from a closed set of
// characters — no slash, no `..`, no `%` to smuggle an encoded one.
function isOwnLogoPath(ownerId: string, path: string): boolean {
  const prefix = `${ownerId}/`;
  if (!path.startsWith(prefix)) return false;
  const file = path.slice(prefix.length);
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(file) && !file.includes("..");
}

// `updateLogo` and `deleteLogo` lived here until 2026-11-02 and wrote the logo
// on the spot, outside "Guardar cambios". The owner deleted his logo, left
// without saving, and found it gone. The logo now travels in the form's hidden
// `logo_path` field and `updateBusinessSettings` applies it; see LogoUploader.

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

  // WHAT STOPS THE BUSINESS FROM SAVING ITS OWN DATA. Filed under the owner.
  const rechazar = (
    reason: "required_field" | "invalid_whatsapp" | "invalid_country" | "logo_gone" | "db_error",
    error: string,
  ) => {
    trackServer("Business Profile Rejected", user.id, { reason }, user.email);
    return { error, success: false };
  };

  const businessName = String(formData.get("business_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const taxId = String(formData.get("tax_id") ?? "").trim();
  const logoPath = String(formData.get("logo_path") ?? "").trim();
  const country = String(formData.get("country") ?? "CO");

  if (!businessName || !firstName || !lastName) {
    return rechazar("required_field", "Completa nombre del negocio, nombre y apellido.");
  }
  // Required at signup, so "Mi negocio" can't be the place it gets cleared —
  // it's the number clients reach the business on from every share link.
  if (!whatsapp) {
    return rechazar("invalid_whatsapp", "Escribe el WhatsApp del negocio.");
  }
  if (country !== "CO" && country !== "VE") {
    return rechazar("invalid_country", "País inválido.");
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
      return { error: mensajeDeError("guardar la tasa de cambio", rateError, "tasa"), success: false };
    }
  }

  // A path outside the owner's folder is dropped, not rejected: failing the
  // whole save would leave an owner unable to edit their business details
  // over a hidden field they never touched. Dropping it keeps the stored logo
  // as it is; an empty value still clears it.
  const logoUpdate =
    !logoPath ? { logo_path: null } : isOwnLogoPath(user.id, logoPath) ? { logo_path: logoPath } : {};

  // The logo being replaced or removed, read BEFORE the update so its file can
  // be cleaned up once the new value is saved.
  const { data: before } = await supabase.from("owners").select("logo_path").eq("id", user.id).single();

  // A logo uploaded and left unsaved for more than 7 days may have been
  // removed by the nightly cleanup (`DM-12`, migration 182). Checked only when
  // the path is new: the saved one is referenced and never cleaned.
  if (
    "logo_path" in logoUpdate &&
    logoUpdate.logo_path &&
    logoUpdate.logo_path !== (before?.logo_path ?? null) &&
    !(await storageFileExists("logos", logoUpdate.logo_path))
  ) {
    trackServer("Business Profile Rejected", user.id, { reason: "logo_gone" }, user.email);
    return {
      error: "El logo que subiste ya no está disponible. Vuelve a subirlo y guarda de nuevo.",
      success: false,
    };
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
      ...logoUpdate,
      // `payment_info` is no longer written from here: since migration 179
      // payment methods live in `owner_payment_methods`, one row each, saved
      // by their own actions below. Writing `formData.get("payment_info")`
      // now would read the absent field as "" and wipe the old text that a
      // code rollback still depends on.
      country,
    })
    .eq("id", user.id);

  if (error) {
    return rechazar("db_error", mensajeDeGuardado(error));
  }

  // Remove the replaced file only after the new value is saved: deleting first
  // and then failing the update would leave the owner pointing at nothing.
  // `isOwnLogoPath` on the OLD value too: a row that ever pointed into another
  // business's folder (finding 10) must not be able to delete that file.
  const previous = before?.logo_path ?? null;
  if ("logo_path" in logoUpdate && previous && previous !== logoUpdate.logo_path && isOwnLogoPath(user.id, previous)) {
    const { error: removeError } = await supabase.storage.from("logos").remove([previous]);
    // Not the owner's problem: his logo is saved; at worst an unused file stays.
    if (removeError) console.error("updateBusinessSettings: remove old logo", removeError);
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");

  // DO BUSINESSES COMPLETE THEIR PROFILE? A logo and a WhatsApp are what the client sees.
  // Yes or no per field: none of the values travels. Filed under the owner.
  trackServer(
    "Business Profile Saved",
    user.id,
    {
      has_logo: "logo_path" in logoUpdate ? Boolean(logoUpdate.logo_path) : Boolean(before?.logo_path),
      has_whatsapp: Boolean(whatsapp),
      has_address: Boolean(address),
      has_tax_id: Boolean(taxId),
    },
    user.email,
  );
  return { error: null, success: true };
}

// ── Payment methods ────────────────────────────────────────────────────────
//
// One row per method in `owner_payment_methods` (migration 179). Each save
// stands on its own the moment the dialog closes -- the owner's choice on
// 2026-11-02, «Al instante» -- so these never go through the "Guardar
// cambios" of the form and never make it dirty.
//
// Every query names `owner_id = user.id` even though RLS already does: the
// method id comes from the browser, and CLAUDE.md wants the ownership check
// written in code, with RLS as the backstop. An update or delete that matches
// no row returns an error instead of a silent success, so editing someone
// else's id reads as a failure, not as "saved".

export type PaymentMethod = { id: string; body: string };
type PaymentMethodResult = { error: string | null; method?: PaymentMethod };

const PAYMENT_METHOD_MAX_LENGTH = 500;
// No shop needs more; the cap exists so a script cannot grow the list without
// bound. The screen hides "Agregar" at this count, and the server refuses past it.
const PAYMENT_METHODS_LIMIT = 10;

function cleanPaymentMethod(body: unknown): { body: string } | { error: string } {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { error: "Escribe el método de pago." };
  if (text.length > PAYMENT_METHOD_MAX_LENGTH) {
    return { error: `Máximo ${PAYMENT_METHOD_MAX_LENGTH} caracteres.` };
  }
  return { body: text };
}

export async function addPaymentMethod(body: string): Promise<PaymentMethodResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const clean = cleanPaymentMethod(body);
  if ("error" in clean) return { error: clean.error };

  const { count } = await supabase
    .from("owner_payment_methods")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);
  if ((count ?? 0) >= PAYMENT_METHODS_LIMIT) {
    return { error: `Puedes tener hasta ${PAYMENT_METHODS_LIMIT} métodos de pago.` };
  }

  const { data, error } = await supabase
    .from("owner_payment_methods")
    .insert({ owner_id: user.id, body: clean.body })
    .select("id, body")
    .single();
  if (error || !data) {
    return { error: mensajeDeError("guardar el método de pago", error, "payment_method") };
  }

  revalidatePath("/profile");
  // DO BUSINESSES WRITE DOWN HOW THEY GET PAID? The client sees it when paying. The
  // text itself never travels. Filed under the owner.
  trackServer("Payment Method Changed", user.id, { action: "add" }, user.email);
  return { error: null, method: data };
}

export async function updatePaymentMethod(id: string, body: string): Promise<PaymentMethodResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const clean = cleanPaymentMethod(body);
  if ("error" in clean) return { error: clean.error };

  const { data, error } = await supabase
    .from("owner_payment_methods")
    .update({ body: clean.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, body")
    .maybeSingle();
  if (error) return { error: mensajeDeError("guardar el método de pago", error, "payment_method") };
  if (!data) return { error: "Este método de pago ya no existe. Recarga la pantalla." };

  revalidatePath("/profile");
  trackServer("Payment Method Changed", user.id, { action: "update" }, user.email);
  return { error: null, method: data };
}

export async function deletePaymentMethod(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data, error } = await supabase
    .from("owner_payment_methods")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id");
  if (error) return { error: mensajeDeError("borrar el método de pago", error, "payment_method") };
  if (!data?.length) return { error: "Este método de pago ya no existe. Recarga la pantalla." };

  revalidatePath("/profile");
  trackServer("Payment Method Changed", user.id, { action: "delete" }, user.email);
  return { error: null };
}

export type PasswordState = { error: string | null; success: boolean };

export async function changePassword(
  _prevState: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const supabase = await createClient();
  // HOW MANY CHANGE THEIR PASSWORD, AND WHAT STOPS THEM. Filed under the owner.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const contar = (reason?: "complexity" | "mismatch" | "leaked" | "other") => {
    if (user) {
      trackServer(
        "Password Change Attempted",
        user.id,
        reason ? { result: "rejected", reason } : { result: "success" },
        user.email,
      );
    }
  };
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) {
    contar("complexity");
    return { error: passwordError, success: false };
  }
  if (newPassword !== confirmPassword) {
    contar("mismatch");
    return { error: "Las contraseñas no coinciden.", success: false };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    contar(error.code === "weak_password" ? "leaked" : "other");
    if (error.code === "weak_password") return { error: LEAKED_PASSWORD_MESSAGE, success: false };
    return { error: "No pudimos actualizar tu contraseña. Intenta de nuevo.", success: false };
  }

  contar();
  return { error: null, success: true };
}

// ── Avisos por WhatsApp ───────────────────────────────────────────────────
//
// EL TEXTO SE GUARDA CON LA FECHA, Y ESO ES EL PUNTO DE TODO ESTO.
//
// Meta exige recoger el consentimiento fuera de WhatsApp y poder demostrarlo
// si el número empieza a recibir reportes. Una marca de tiempo sola no
// demuestra nada: la frase de la pantalla va a cambiar, y lo que hay que poder
// enseñar es lo que ESA persona leyó el día que aceptó, no lo que diga la
// pantalla dentro de un año.
//
// Por eso el cliente manda el texto que tenía delante y el servidor lo guarda
// tal cual. Es el único dato de este formulario que viene del navegador y se
// escribe sin transformar — deliberadamente, porque su valor es ser una copia
// literal de lo que se mostró.
//
// Lo que NO se borra al desactivar: ni la fecha ni el texto. La evidencia es
// que el consentimiento existió ese día; borrarla al apagar el interruptor
// eliminaría justo la prueba. `whatsapp_opt_out_at` cuenta la otra mitad de la
// historia, y `esta_activo()` en lib/whatsapp-opt-in.ts es quien decide.
export async function guardarAvisosWhatsapp(
  activar: boolean,
  textoMostrado: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // Sin número no hay a dónde mandar nada, y dejar aceptar en ese estado
  // guardaría un consentimiento que no se puede usar. El WhatsApp del dueño es
  // obligatorio al registrarse, así que esto solo salta en cuentas viejas.
  if (activar) {
    const { data: owner } = await supabase
      .from("owners")
      .select("whatsapp")
      .eq("id", user.id)
      .single();
    if (!owner?.whatsapp?.trim()) {
      return { error: "Escribe tu WhatsApp arriba y guarda antes de activar los avisos." };
    }
  }

  const ahora = new Date().toISOString();
  const { error } = await supabase
    .from("owners")
    .update(
      activar
        ? { whatsapp_opt_in_at: ahora, whatsapp_opt_in_text: textoMostrado, whatsapp_opt_out_at: null }
        : { whatsapp_opt_out_at: ahora },
    )
    // Redundante con RLS y con `.eq("id", user.id)` siendo la propia fila, y
    // aun así explícito: es la regla de CLAUDE.md. RLS es el respaldo, no la
    // única línea.
    .eq("id", user.id);

  if (error) {
    console.error("guardarAvisosWhatsapp:", error);
    return { error: "No pudimos guardar tu preferencia. Intenta de nuevo." };
  }

  // HOW MANY OWNERS ACCEPT THE WHATSAPP NOTICES. Filed under the owner.
  trackServer("Owner Notices Changed", user.id, { enabled: activar }, user.email);
  revalidatePath("/profile");
  return { error: null };
}

// Deja constancia de que el diálogo se enseñó. Se llama AL MOSTRARLO, no al
// contestarlo: si se anotara al contestar, recargar la pantalla antes de
// responder lo volvería a sacar, y otra vez, y otra. Anotar al aparecer lo
// hace idempotente por sesión sin guardar nada en el navegador.
//
// No devuelve error al llamante a propósito. Si esto falla, lo peor que pasa
// es que el diálogo salga una vez de más; romperle la pantalla al dueño por no
// poder escribir un contador sería un intercambio pésimo. Queda en el log.
export async function registrarPreguntaAvisos(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: owner } = await supabase
    .from("owners")
    .select("whatsapp_prompt_count")
    .eq("id", user.id)
    .single();

  const { error } = await supabase
    .from("owners")
    .update({
      whatsapp_prompt_last_at: new Date().toISOString(),
      whatsapp_prompt_count: (owner?.whatsapp_prompt_count ?? 0) + 1,
    })
    .eq("id", user.id);

  if (error) console.error("registrarPreguntaAvisos:", error);
  // DOES THE QUESTION ON INICIO CONVINCE, AND AT WHICH TRY? It has a cap of three.
  else trackServer("Owner Notices Prompt Shown", user.id, { ask_number: (owner?.whatsapp_prompt_count ?? 0) + 1 }, user.email);
}
