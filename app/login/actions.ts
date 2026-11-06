"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { headers } from "next/headers";
import { landingAfterLogin } from "@/lib/auth/landing-after-login";
import { currentDeviceHash, mustResetPassword, recordLoginDevice } from "@/lib/security/new-device";
import { maskedTarget, sendCode, setLoginTicket, verifyPassword } from "@/lib/security/second-factor";
import { rejectionText } from "@/lib/security/code-text";

export type AuthState = { error: string | null; email?: string };

const WRONG = "Correo o contraseña incorrectos.";

async function sendResetEmail(supabase: Awaited<ReturnType<typeof createClient>>, email: string): Promise<void> {
  try {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` });
  } catch (e) {
    console.error("[login] reset email:", e instanceof Error ? e.message : e);
  }
}

export async function login(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresa tu correo y contraseña.", email };
  }

  const supabase = await createClient();

  // THE SECOND FACTOR GATE (C1 of PL-22). Before any session exists: does this account have
  // the factor on, and is this browser a device it already knows (the cookie, and only the
  // cookie)? When both say «ask», the password is checked without opening a session, a code
  // goes out, and the browser is sent to /login/codigo with a ten-minute ticket. The real
  // session is minted there, after the code. An unknown email answers exactly like a wrong
  // password: the gate must not become a way to learn which emails have an account.
  type Gate = {
    found?: boolean;
    owner_id?: string;
    email?: string;
    whatsapp?: string | null;
    owner_country?: string | null;
    second_factor?: boolean;
    must_reset?: boolean;
    device_known?: boolean;
  };
  const gate: Gate | null = await (async () => {
    try {
      const { data, error } = await createServiceClient().rpc("second_factor_gate", {
        p_email: email,
        p_device_hash: await currentDeviceHash(),
      });
      if (error) {
        console.error("[login] second_factor_gate:", error.message);
        return null;
      }
      return data as Gate;
    } catch (e) {
      console.error("[login] second_factor_gate:", e instanceof Error ? e.message : e);
      return null;
    }
  })();

  if (gate?.found && gate.second_factor && !gate.device_known && gate.owner_id) {
    const check = await verifyPassword(gate.owner_id, email, password);
    if (check === "wrong") return { error: WRONG, email };
    if (check === "too_many") return { error: "Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.", email };
    if (check === "error") return { error: "No pudimos comprobar tu contraseña. Inténtalo de nuevo.", email };

    if (gate.must_reset) {
      await sendResetEmail(supabase, email);
      trackServer("Login Blocked Pending Reset", gate.owner_id, {}, email);
      return { error: "Por seguridad, elige una contraseña nueva: te enviamos un enlace a tu correo.", email };
    }

    // WhatsApp when the account has a number; the email otherwise. The screen offers the
    // email after the first resend either way.
    const channel = gate.whatsapp ? "whatsapp" : "email";
    const sent = await sendCode({
      ownerId: gate.owner_id,
      email: gate.email ?? email,
      purpose: "login",
      channel,
      target: channel === "whatsapp" ? gate.whatsapp! : gate.email ?? email,
      ownerCountry: gate.owner_country ?? null,
    });
    if (!sent.ok) return { error: rejectionText(sent.code), email };

    await setLoginTicket({
      ownerId: gate.owner_id,
      email: gate.email ?? email,
      ticket: sent.ticket,
      channel: sent.channel,
      masked: maskedTarget(sent.channel, sent.target),
      resends: 0,
      whatsapp: gate.whatsapp ?? null,
      ownerCountry: gate.owner_country ?? null,
    });
    redirect("/login/codigo");
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: WRONG, email };
  }

  // AFTER «NO FUI YO» THE OLD PASSWORD OPENS NOTHING (C2 of PL-22). The account is marked
  // until a new password is set through the reset email, so the thief who knows the old one
  // is kept out, and the owner gets the email again right here in case the first was lost.
  if (data.user && (await mustResetPassword(supabase))) {
    await supabase.auth.signOut({ scope: "local" });
    await sendResetEmail(supabase, email);
    trackServer("Login Blocked Pending Reset", data.user.id, {}, data.user.email);
    return {
      error: "Por seguridad, elige una contraseña nueva: te enviamos un enlace a tu correo.",
      email,
    };
  }

  // Which device this is, and the WhatsApp alert if it is a new one. Never fails the sign-in.
  const device = data.user ? await recordLoginDevice({ id: data.user.id, email: data.user.email ?? null }) : null;

  // HOW MANY COME BACK, and how many who signed up ever reach the app. Filed under the
  // owner. `new_device` says whether this sign-in came from a device Sevenz did not know;
  // `second_factor` whether a code was asked for on the way in (C1).
  if (data.user) trackServer("Login Completed", data.user.id, { new_device: device?.isNew ?? false, second_factor: false }, data.user.email);

  redirect(await landingAfterLogin());
}
