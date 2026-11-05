import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { enviarAvisoAlDueno } from "@/lib/whatsapp/send";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_DAYS,
  NOT_ME_TOKEN_HOURS,
  deviceText,
  identityFromHeaders,
  placeText,
  templateSafe,
  whenText,
} from "@/lib/security/device-text";

// WHAT HAPPENS RIGHT AFTER A SHOPKEEPER SIGNS IN (C2 of PL-22). Owner's decision of
// 2026-11-05. Three steps, none of which may fail the sign-in:
//
//   1. Recognise the device: the `sz_device` cookie, or failing that the same browser in
//      the same place in the last 90 days (`register_login_device`, migration 192).
//   2. If it is new and the account already had a known device, send the WhatsApp
//      `new_device_login_alert` with a one-use «No fui yo» button.
//   3. Record it either way, so the list of known devices fills up from day one.
//
// THE ALERT IS BEHIND `NEW_DEVICE_ALERTS=on`. Meta has to approve the template first; until
// then sending would fail at Kapso and fill `whatsapp_sends` with errors. Devices are recorded
// regardless, which is the point of shipping the switch off: by the day it turns on, every
// owner's phone is already known and the first alerts are real ones.
//
// THE NUMBER IS READ INSIDE THE FUNCTION, AT THIS SIGN-IN. A thief who changes the profile's
// WhatsApp number in an earlier session would already own the account; this alert is for the
// moment they come in. Changing the number also notifies the old one (TODO with C2's second
// cut, see PL-18).
//
// BUSINESS QUESTIONS, in the owner's words of 2026-11-05: «¿fuiste tú?». `New Device Alert
// Sent` says how often an owner's account is opened from an unknown device; `Session Revoked
// By Owner` (the page) says how many of those were not them. If the second stays at zero for
// months, the 90-day rule is too loose or the alerts are noise; if it is not zero, C1 (second
// factor) moves up the list. Both filed under the owner, sent from the server: the browser is
// never trusted with this. The first is a floor only as far as Kapso is.

export type LoginDeviceResult = { isNew: boolean; alerted: boolean };

const SILENT: LoginDeviceResult = { isNew: false, alerted: false };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function alertsEnabled(): boolean {
  return process.env.NEW_DEVICE_ALERTS === "on";
}

export async function recordLoginDevice(user: { id: string; email: string | null }): Promise<LoginDeviceResult> {
  try {
    const jar = await cookies();
    let raw = jar.get(DEVICE_COOKIE)?.value ?? "";
    if (!/^[A-Za-z0-9_-]{32,}$/.test(raw)) {
      raw = randomBytes(24).toString("base64url");
    }
    // Refreshed on every sign-in so an active device never ages out.
    jar.set(DEVICE_COOKIE, raw, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DEVICE_COOKIE_DAYS * 24 * 3600,
    });

    const identity = identityFromHeaders(await headers());
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("register_login_device", {
      p_owner_id: user.id,
      p_device_hash: sha256(raw),
      p_browser: identity.browser,
      p_country: identity.country,
      p_city: identity.city,
    });
    if (error) {
      console.error("[aparato nuevo] register_login_device:", error.message);
      return SILENT;
    }
    const r = data as {
      ok?: boolean;
      known?: boolean;
      first_ever?: boolean;
      known_devices?: number;
      whatsapp?: string | null;
      owner_country?: string | null;
    } | null;
    if (!r?.ok) return SILENT;
    if (r.known || r.first_ever) return { isNew: !r.known, alerted: false };

    if (!alertsEnabled() || !r.whatsapp) return { isNew: true, alerted: false };

    const token = randomBytes(24).toString("base64url");
    const { error: tokenError } = await supabase.rpc("create_not_me_token", {
      p_owner_id: user.id,
      p_token_hash: sha256(token),
      p_ttl_hours: NOT_ME_TOKEN_HOURS,
    });
    if (tokenError) {
      console.error("[aparato nuevo] create_not_me_token:", tokenError.message);
      return { isNew: true, alerted: false };
    }

    const now = new Date().toISOString();
    const envio = await enviarAvisoAlDueno({
      ownerId: user.id,
      to: r.whatsapp,
      plantilla: "new_device_login_alert",
      // One alert per device and day: a flaky connection that signs in three times in a
      // morning must not send three messages.
      periodKey: `${now.slice(0, 10)}:${sha256(raw).slice(0, 12)}`,
      parametrosCuerpo: [
        { nombre: "when", texto: templateSafe(whenText(now, r.owner_country ?? null)) },
        { nombre: "device", texto: templateSafe(deviceText(identity)) },
        { nombre: "place", texto: templateSafe(placeText(identity)) },
      ],
      parametroBoton: { nombre: "1", texto: token },
    });
    const alerted = envio.estado === "enviado";
    if (alerted) {
      trackServer("New Device Alert Sent", user.id, { known_devices: r.known_devices ?? 0 }, user.email);
    }
    return { isNew: true, alerted };
  } catch (e) {
    // Analytics and alerts never reach the sign-in form: the shopkeeper is already in.
    console.error("[aparato nuevo]:", e instanceof Error ? e.message : e);
    return SILENT;
  }
}

/** Whether this account must set a new password before using the app (after «No fui yo»). */
export async function mustResetPassword(supabase: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("my_security_state");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export function hashNotMeToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  return sha256(token);
}
