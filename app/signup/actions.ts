"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LEAKED_PASSWORD_MESSAGE, validatePasswordComplexity } from "@/lib/password";
import { TEXTO_AVISOS_WHATSAPP_REGISTRO_V2 } from "@/lib/whatsapp-opt-in";
import { isReferralSource } from "@/lib/referral-source";
import { mensajeDeError } from "@/lib/errores-legibles";

export type SignupFieldValues = {
  business_name: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  country: string;
  email: string;
  referral_source: string;
};

export type SignupState = {
  error: string | null;
  success: boolean;
  alreadyRegistered?: boolean;
  // Echoed back on every failure so the form can restore what the owner
  // already typed. Deliberately excludes password/confirm_password — a
  // slow connection can mean the tap lands before this page's JS finishes
  // hydrating, so the browser falls back to a real (non-AJAX) form POST,
  // which reloads the page and wipes every field's in-memory value. That
  // reload is otherwise invisible to the visitor; the only fix is having
  // the server hand the values back so the fresh render can restore them.
  values?: SignupFieldValues;
};

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const businessName = String(formData.get("business_name") ?? "").trim();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const country = String(formData.get("country") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const referralSource = String(formData.get("referral_source") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const acceptedTerms = formData.get("accepted_terms") === "on";

  const values: SignupFieldValues = {
    business_name: businessName,
    first_name: firstName,
    last_name: lastName,
    whatsapp,
    country,
    email,
    referral_source: referralSource,
  };

  // WHICH VALIDATION LOSES SOMEONE WHO WANTED IN. There is no user yet, so these go
  // under one fixed id: they count reasons, not people.
  const rechazar = (reason: string, error: string) => {
    trackServer("Signup Rejected", "anonymous-signup", { reason });
    return { error, success: false, values };
  };

  if (!businessName || !firstName || !lastName || !whatsapp || !email || !password) {
    return rechazar("fields_missing", "Completa todos los campos.");
  }
  if (country !== "CO" && country !== "VE") {
    return rechazar("country_invalid", "Selecciona un país válido.");
  }
  // Re-checked here even though the form disables submit until it is answered
  // — a raw POST to this action must not be able to skip it, same reason the
  // terms checkbox is re-checked below. An unrecognised value is rejected
  // rather than stored: the trigger would drop it to null anyway, and the
  // owner would have "answered" a question the data never received.
  if (!isReferralSource(referralSource)) {
    return rechazar("referral_missing", "Dinos cómo conociste Sevenz.");
  }
  // Matches the password policy set in Supabase Auth (Sign In / Providers →
  // Email → "Password requirements") — checked here too so a mismatch is a
  // friendly Spanish message instead of Supabase's own raw rejection.
  const passwordError = validatePasswordComplexity(password);
  if (passwordError) {
    return rechazar("password_weak", passwordError);
  }
  if (password !== confirmPassword) {
    return rechazar("password_mismatch", "Las contraseñas no coinciden.");
  }
  // Re-checked here even though the form disables submit until this is
  // checked — a raw POST to this action must not be able to skip it.
  if (!acceptedTerms) {
    return rechazar("terms_missing", "Debes aceptar los Términos y condiciones.");
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
        country,
        referral_source: referralSource,
        // EL CONSENTIMIENTO DE LOS AVISOS POR WHATSAPP.
        //
        // Se manda la FRASE, no un booleano: es lo que esa persona leyó encima
        // del botón de crear cuenta, y es la evidencia que habría que enseñar
        // si el número empieza a recibir reportes. El texto de la pantalla va a
        // cambiar; lo que se guarda no.
        //
        // Es la constante DEL REGISTRO, no la de Mi negocio. Son dos
        // pantallas que dicen cosas distintas, y cada ficha guarda la frase de
        // la pantalla por la que pasó esa persona.
        //
        // De aquí lo recoge handle_new_user() (migración 070) al crear la fila
        // de `owners`. No se actualiza desde esta acción porque al terminar
        // signUp() todavía no hay sesión —la confirmación de correo está
        // activada— y el update chocaría con la política `id = auth.uid()`.
        whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP_REGISTRO_V2,
      },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true, values };
    }
    // Supabase's leaked-password check (HaveIBeenPwned) rejects this at the
    // API level, after our own validatePasswordComplexity already passed —
    // it's a different check (breach-database lookup, not complexity
    // rules), so it needs its own Spanish message rather than falling
    // through to the raw-English fallback below. error.code is the stable
    // identifier Supabase docs recommend checking, not the message text.
    if (error.code === "weak_password") {
      return {
        error: LEAKED_PASSWORD_MESSAGE,
        success: false,
        values,
      };
    }
    // Hasta el 2026-10-01 este error salía TAL CUAL, en inglés, "para no
    // necesitar acceso al log". Lo lee alguien que está creando su primera
    // cuenta y que no programa, así que ahora sale el mensaje legible y el
    // detalle entero se escribe en el log desde `mensajeDeError`. Los dos casos
    // de arriba —correo ya registrado y contraseña filtrada— siguen teniendo su
    // frase propia, que dice más que cualquier genérico.
    //
    // Y esta pantalla no pide sesión, así que además era la única excepción que
    // se saltaba la regla de `CLAUDE.md` sobre no filtrar errores crudos en
    // superficies sin autenticar.
    return rechazar("auth_error", mensajeDeError("crear tu cuenta", error, "signup"));
  }

  // Supabase returns no error for a duplicate email when email confirmation is
  // required (to avoid leaking which emails are registered) — it just skips
  // creating a new identity. That's the only signal we get, so check for it.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "Ese correo ya tiene una cuenta.", success: false, alreadyRegistered: true, values };
  }

  // HOW MANY BUSINESSES SIGN UP, AND FROM WHERE. There was no way to read activation:
  // nothing fired before the first screen inside the app. It decides which channel to
  // keep. On the server because the browser has no session yet, and `/api/track`
  // answers 307 here. Filed under the new owner's id.
  if (data.user) {
    trackServer("Signup Completed", data.user.id, {
      country,
      referral_source: referralSource,
      email_confirmation_required: !data.session,
    });
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return { error: null, success: true };
}
