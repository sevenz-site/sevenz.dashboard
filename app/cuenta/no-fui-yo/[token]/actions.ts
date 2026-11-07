"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { hashNotMeToken } from "@/lib/security/new-device";
import { logSecurityAudit } from "@/lib/security/second-factor";

export type NotMeState = { done: boolean; error: string | null };

// The tap on «Sí, cerrar todas las sesiones». Consumes the one-use token, which closes every
// session of the account and marks it so the next sign-in needs a new password
// (`consume_not_me_token`, migration 192), then starts that reset by email. Unauthenticated
// by design; the token is the authorisation, and it works once.
export async function confirmNotMe(_prev: NotMeState, formData: FormData): Promise<NotMeState> {
  const token = String(formData.get("token") ?? "");
  const hash = hashNotMeToken(token);
  if (!hash) return { done: false, error: "Este enlace no es válido." };

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("consume_not_me_token", { p_token_hash: hash });
  if (error) {
    console.error("[no fui yo] consume:", error.message);
    return { done: false, error: "No pudimos cerrar las sesiones. Intenta de nuevo en un momento." };
  }
  const r = data as { ok?: boolean; code?: string; owner_id?: string; email?: string | null } | null;
  if (!r?.ok) {
    return {
      done: false,
      error:
        r?.code === "used"
          ? "Este enlace ya se usó: las sesiones ya están cerradas."
          : r?.code === "expired"
            ? "Este enlace caducó. Entra a Sevenz y elige «Cerrar sesión en todos mis dispositivos»."
            : "Este enlace no es válido.",
    };
  }

  // The reset email goes out now, so the owner regains the account without typing anything
  // here. Supabase's own mail, the one that already confirms sign-ups: no new vendor. A
  // failure here is logged and the page still says the sessions are closed, because they are.
  if (r.email) {
    try {
      const h = await headers();
      const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
      const supabase = await createClient();
      const { error: mailError } = await supabase.auth.resetPasswordForEmail(r.email, { redirectTo: `${origin}/reset-password` });
      if (mailError) console.error("[no fui yo] reset email:", mailError.message);
    } catch (e) {
      console.error("[no fui yo] reset email:", e instanceof Error ? e.message : e);
    }
  }

  if (r.owner_id) {
    trackServer("Session Revoked By Owner", r.owner_id, { reason: "not_me" }, r.email ?? undefined);
    // The first thing support wants to see when this owner calls (the owner's decision
    // of 2026-11-07). The sessions are closed by now: a failure here changes nothing.
    try {
      await logSecurityAudit(r.owner_id, "not_me_confirmed", "owner", {});
    } catch (e) {
      console.error("[no fui yo] audit:", e instanceof Error ? e.message : e);
    }
  }
  return { done: true, error: null };
}
