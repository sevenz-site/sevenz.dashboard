import "server-only";

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";
import { zonaDelNegocio } from "@/lib/format";
import { templateSafe } from "@/lib/security/device-text";

// `account_ready`: «confirmaste tu correo y la cuenta de … en Sevenz quedó activa».
//
// Approved by Meta as Utility, reported by the owner on 2026-11-12, and wired the same day at
// his request: «Implementemos tu plan considerando los casos donde se rompe y como
// solucionarlo». The copy and its spec live in ../docs/WHATSAPP-PLANTILLAS.md.
//
// WHEN IT GOES OUT. Once in an account's life. Two doors, one decision:
//   - the account's first sign-in (`recordLoginDevice`, first device ever), right after the
//     response, so the shopkeeper reads it while the app is still open;
//   - the daily WhatsApp cron, as a catch-up for a send that failed and for anyone who
//     confirmed and never signed in.
// WHO qualifies is decided only by `account_ready_target` (migration 200): confirmed in the
// last 3 days, in trial with an end date ahead, not a test account, a number with consent,
// never sent before. The old accounts that record their first device after v0.5.1 are why
// the 3-day window exists: without it they would all be told their account just went live.
//
// IT DOES NOT TAKE ONE OF THE TWO WEEKLY SLOTS. Owner's rule of 2026-11-06 («dos mensajes a la
// semana»): `account_ready` occupies no slot because «la semana del registro no hay otra».
// That holds with the business family (`MS-51`); with today's weekly summary a new account
// that already has something to collect can still get three messages its first week.
//
// NO MIXPANEL EVENT OF ITS OWN: `enviarPlantilla` already sends `WhatsApp Message Sent` with
// `template: "account_ready"` and whether it failed, which answers «¿le llegó?».

export const ACCOUNT_READY_TEMPLATE = "account_ready";
// The send gate keys on (owner, template, period). One period for the whole life of the
// account, so a second send is refused by the database, not by this file.
const ONCE = "una-vez";

type Target =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      whatsapp: string;
      first_name: string | null;
      business_name: string | null;
      country: string | null;
      trial_ends_at: string;
    };

/** «6 de febrero», in the business's zone: the day the trial ends, the way the template reads it. */
export function trialEndText(iso: string, ownerCountry: string | null): string {
  const partes = new Intl.DateTimeFormat("es", {
    timeZone: zonaDelNegocio(ownerCountry),
    day: "numeric",
    month: "long",
  }).formatToParts(new Date(iso));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")} de ${parte("month")}`;
}

/** The three body parameters, by name and in the order Meta approved. */
export function accountReadyParameters(t: Extract<Target, { eligible: true }>) {
  const business = templateSafe(t.business_name?.trim() ?? "");
  // A signup always carries a first name, but a missing one must not print «Hola ,». The
  // business name reads naturally in its place («Hola Bodega La Esquina, …»).
  const name = templateSafe(t.first_name?.trim() || business);
  return [
    { nombre: "owner_name", texto: name },
    { nombre: "business_name", texto: business },
    { nombre: "trial_end_date", texto: trialEndText(t.trial_ends_at, t.country) },
  ];
}

export async function sendAccountReady(ownerId: string): Promise<ResultadoEnvio> {
  const { data, error } = await createServiceClient().rpc("account_ready_target", { p_owner_id: ownerId });
  if (error) {
    console.error("[account_ready] account_ready_target:", error.message);
    return { estado: "fallido", error: "No se pudo leer la cuenta." };
  }
  const target = data as Target;
  if (!target.eligible) return { estado: "omitido", motivo: target.reason };

  const parametros = accountReadyParameters(target);
  // Both are required by the copy; a blank one would be rejected by Meta, or worse, read
  // «la cuenta de  en Sevenz».
  if (parametros.some((p) => !p.texto)) return { estado: "omitido", motivo: "datos_vacios" };

  return enviarAvisoAlDueno({
    ownerId,
    to: target.whatsapp,
    plantilla: ACCOUNT_READY_TEMPLATE,
    periodKey: ONCE,
    parametrosCuerpo: parametros,
    // The approved button is a STATIC url (https://app.sevenz.site): no parameter goes with
    // it, or Meta answers 132018 and drops the whole message.
  });
}

/**
 * From the sign-in: after the response when there is a request to hang it on, so the form
 * never waits on Kapso; right away otherwise (a script, a test), and then it is awaited.
 * Never throws: a welcome message must not fail a sign-in.
 */
export async function scheduleAccountReady(ownerId: string): Promise<void> {
  const task = async () => {
    try {
      await sendAccountReady(ownerId);
    } catch (e) {
      console.error("[account_ready]:", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(task);
  } catch {
    await task();
  }
}

/** From the daily cron: everyone confirmed inside the window who has not received it yet. */
export async function sendPendingAccountReady(): Promise<{ candidatos: number; enviados: number; omitidos: number; fallidos: number }> {
  const { data, error } = await createServiceClient().rpc("account_ready_pending");
  if (error) {
    console.error("[account_ready] account_ready_pending:", error.message);
    return { candidatos: 0, enviados: 0, omitidos: 0, fallidos: 0 };
  }
  const ids = ((data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : String((r as Record<string, unknown>)?.account_ready_pending ?? r)));
  const resumen = { candidatos: ids.length, enviados: 0, omitidos: 0, fallidos: 0 };
  for (const id of ids) {
    const r = await sendAccountReady(id);
    if (r.estado === "enviado") resumen.enviados += 1;
    else if (r.estado === "omitido") resumen.omitidos += 1;
    else resumen.fallidos += 1;
  }
  return resumen;
}
