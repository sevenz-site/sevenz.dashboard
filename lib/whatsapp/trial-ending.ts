import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";
import { templateSafe } from "@/lib/security/device-text";
import { trialEndText } from "@/lib/whatsapp/account-ready";

// `prueba_por_vencer`: «tu prueba de Sevenz termina el {{trial_end_date}}».
//
// Approved by Meta on 2026-11-07; wired on 2026-11-12 for v0.6.0, owner's decision that day.
// WHO gets it is decided only by `trial_ending_targets` (migration 201): trial ending exactly
// 7 days from today in the business's zone — «Solo los de 7 días», his choice, which means
// accounts already closer on launch day get nothing and a failed morning is not made up on
// another day. In trial, not a test account, number and consent, once in the account's life.
//
// It is the one extraordinary third message of the week and takes no slot.
//
// NO EVENT OF ITS OWN: `WhatsApp Message Sent` with `template: "prueba_por_vencer"` already
// answers whether it went out.

export const TRIAL_ENDING_TEMPLATE = "prueba_por_vencer";
const ONCE = "una-vez";

type Target = {
  owner_id: string;
  whatsapp: string;
  first_name: string | null;
  business_name: string | null;
  country: string | null;
  trial_ends_at: string;
};

/** The two body parameters, by name and in the order of the spec. */
export function trialEndingParameters(t: Omit<Target, "owner_id" | "whatsapp">) {
  const name = templateSafe(t.first_name?.trim() || t.business_name?.trim() || "");
  return [
    { nombre: "owner_name", texto: name },
    { nombre: "trial_end_date", texto: trialEndText(t.trial_ends_at, t.country) },
  ];
}

async function sendOne(t: Target): Promise<ResultadoEnvio> {
  const parametros = trialEndingParameters(t);
  if (parametros.some((p) => !p.texto)) return { estado: "omitido", motivo: "datos_vacios" };
  return enviarAvisoAlDueno({
    ownerId: t.owner_id,
    to: t.whatsapp,
    plantilla: TRIAL_ENDING_TEMPLATE,
    periodKey: ONCE,
    parametrosCuerpo: parametros,
    // Static button («Ver mi negocio» → https://app.sevenz.site): nothing goes with it.
  });
}

/** From the daily cron. Never throws: a failure here must not cost the weekly messages. */
export async function sendTrialEndingNotices(): Promise<{ candidatos: number; enviados: number; omitidos: number; fallidos: number }> {
  const resumen = { candidatos: 0, enviados: 0, omitidos: 0, fallidos: 0 };
  const { data, error } = await createServiceClient().rpc("trial_ending_targets");
  if (error) {
    console.error("[prueba_por_vencer] trial_ending_targets:", error.message);
    return resumen;
  }
  const targets = (data ?? []) as Target[];
  resumen.candidatos = targets.length;
  for (const t of targets) {
    try {
      const r = await sendOne(t);
      if (r.estado === "enviado") resumen.enviados += 1;
      else if (r.estado === "omitido") resumen.omitidos += 1;
      else resumen.fallidos += 1;
    } catch (e) {
      console.error("[prueba_por_vencer]:", e instanceof Error ? e.message : e);
      resumen.fallidos += 1;
    }
  }
  return resumen;
}
