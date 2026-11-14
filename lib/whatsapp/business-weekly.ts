import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { claveSemanal, enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";
import {
  mondayPlan,
  thursdayPlan,
  type SkipReason,
  type WeeklyTarget,
} from "@/lib/whatsapp/business-weekly-text";

// THE MONDAY AND THURSDAY BATCHES. Built on 2026-11-13 for v0.6.0, owner's request «sí
// constrúyelo»: the business family (`negocio_resumen`, `atencion_cobros`, `atencion_negocio`)
// replaces `cartera_summary_v2` for an owner with something owed, and `cartera_attention`
// entirely. Who gets which template, and what it says, is decided in
// `business-weekly-text.ts`; this file only reads the figures, sends in series and remembers.
//
// IN SERIES, NOT IN PARALLEL, for the reason the old senders gave: simultaneous calls trip
// Kapso's rate limit and the failures arrive together with nothing to tell them apart. And
// in series is what lets the phone cap see this run's own sends.
//
// NO EVENT OF ITS OWN: `WhatsApp Message Sent`, which `enviarAvisoAlDueno` already records
// with the template's name, answers whether each one went out.

export type WeeklyBatchResult = {
  periodo: string;
  destinatarios: number;
  enviados: number;
  omitidos: number;
  fallidos: number;
  // Owners who got nothing on purpose, by reason. Kept apart from `omitidos` (the send gate
  // said no) so «nothing to tell him» never hides «the routing broke».
  saltados: Partial<Record<SkipReason, number>>;
  porPlantilla: Record<string, number>;
};

/** Last week's key, for the «clientes nuevos» comparison. */
export function previousWeekKey(now = new Date()): string {
  return claveSemanal(new Date(now.getTime() - 7 * 86_400_000));
}

async function loadTargets(period: string, prevPeriod: string): Promise<WeeklyTarget[]> {
  const { data, error } = await createServiceClient().rpc("whatsapp_business_weekly_targets", {
    p_period: period,
    p_prev_period: prevPeriod,
  });
  if (error) {
    console.error("whatsapp_business_weekly_targets:", error);
    throw new Error("No se pudo leer la lista de destinatarios.");
  }
  return (data ?? []) as WeeklyTarget[];
}

async function runBatch(day: "monday" | "thursday", now = new Date()): Promise<WeeklyBatchResult> {
  const periodo = claveSemanal(now);
  const targets = await loadTargets(periodo, previousWeekKey(now));
  const result: WeeklyBatchResult = {
    periodo,
    destinatarios: targets.length,
    enviados: 0,
    omitidos: 0,
    fallidos: 0,
    saltados: {},
    porPlantilla: {},
  };

  // What THIS run sent to each number. The database count was read once, before the loop.
  const sentByPhone = new Map<string, number>();

  for (const t of targets) {
    const sentOnPhone = sentByPhone.get(t.whatsapp) ?? 0;
    const plan = day === "monday" ? mondayPlan(t, sentOnPhone) : thursdayPlan(t, sentOnPhone);
    if ("skip" in plan) {
      result.saltados[plan.skip] = (result.saltados[plan.skip] ?? 0) + 1;
      continue;
    }

    let r: ResultadoEnvio;
    try {
      r = await enviarAvisoAlDueno({
        ownerId: t.owner_id,
        to: t.whatsapp,
        plantilla: plan.template,
        periodKey: periodo,
        parametrosCuerpo: plan.params,
        // Every template sent from here has a FIXED button or none (`qa/plantillas-esperadas.mjs`):
        // nothing goes with it.
      });
    } catch (e) {
      console.error(`[semanal ${day}] ${t.owner_id}:`, e instanceof Error ? e.message : e);
      r = { estado: "fallido", error: "excepcion" };
    }

    if (r.estado === "enviado") {
      result.enviados += 1;
      result.porPlantilla[plan.template] = (result.porPlantilla[plan.template] ?? 0) + 1;
      sentByPhone.set(t.whatsapp, sentOnPhone + 1);
      if (day === "thursday") await remember(t.owner_id, periodo);
    } else if (r.estado === "omitido") {
      result.omitidos += 1;
    } else {
      result.fallidos += 1;
    }
  }

  return result;
}

// Who was overdue in the Thursday message that just went out, so next Thursday can say how
// many are new. A failure here costs one «(N clientes nuevos)» next week and nothing more,
// so it is logged and never thrown.
async function remember(ownerId: string, period: string): Promise<void> {
  const { error } = await createServiceClient().rpc("whatsapp_attention_remember", {
    p_owner_id: ownerId,
    p_period: period,
  });
  if (error) console.error("whatsapp_attention_remember:", error.message);
}

/** Every day; the Monday slot check decides whether anything goes out. */
export function sendMondayMessages(now = new Date()): Promise<WeeklyBatchResult> {
  return runBatch("monday", now);
}

/** Thursday onwards; the Thursday slot check decides whether anything goes out. */
export function sendThursdayMessages(now = new Date()): Promise<WeeklyBatchResult> {
  return runBatch("thursday", now);
}
