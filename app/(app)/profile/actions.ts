"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validatePasswordComplexity } from "@/lib/password";

export type ProfileState = { error: string | null; success: boolean };

// Las columnas que solo cambia Sevenz —el plan de la cuenta y el país— están
// protegidas por un trigger en la base (migraciones 055 y 056). Si alguna vez
// salta, el texto que devuelve Postgres NO puede acabar en la pantalla del
// tendero: es el fallo del plazo de pago de anteayer otra vez, cuando la 054
// le devolvió "violates check constraint movements_plazo_dias_check" a alguien
// que solo quería fiar.
//
// Hoy no salta nunca: este formulario manda el país que ya tiene, así que no
// cambia nada. Está aquí para el día que alguien toque el formulario y sí
// cambie — que es justo el día en que nadie se acordará de este trigger.
const CODIGO_COLUMNA_PROTEGIDA = "42501";

function mensajeDeGuardado(error: { code?: string; message: string }): string {
  if (error.code === CODIGO_COLUMNA_PROTEGIDA) {
    return "Ese dato solo lo puede cambiar Sevenz. Escríbenos y lo ajustamos.";
  }
  return `No pudimos guardar los cambios: ${error.message}`;
}


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
    return { error: mensajeDeGuardado(error), success: false };
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
}
