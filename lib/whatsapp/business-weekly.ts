import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { ownersPendingDeletion } from "@/lib/account-deletion";
import { claveSemanal, enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";
import {
  mondayPlan,
  monthlyClosePlan,
  thursdayPlan,
  type MonthlyCloseSkip,
  type Plan,
  type SkipReason,
  type WeeklyTarget,
} from "@/lib/whatsapp/business-weekly-text";
import {
  cargarCierreDelMesServidor,
  juevesDeLaSemana,
  mesAnteriorA,
  startOfMonthUtc,
  type CierreDelMes,
} from "@/lib/reports/cierre-del-mes";

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
  // `cierre_mensual`, Thursday only: why it did not go, and how many went as a third message.
  cierreSaltados: Partial<Record<MonthlyCloseSkip | "error_lectura", number>>;
  cierreExtraordinarios: number;
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
  // An owner who asked to delete the account gets no Monday or Thursday message during the
  // 30 days (owner's decision of 2026-11-27, PL-48 step 1.3). If the list of those owners
  // cannot be read, nobody is skipped: see lib/account-deletion.ts.
  const leaving = await ownersPendingDeletion();
  return ((data ?? []) as WeeklyTarget[]).filter((t) => !leaving.has(t.owner_id));
}

// THE OWNERS WHOSE MONDAY SLOT AN INACTIVITY NUDGE ALREADY TOOK (migration 217). The nudge goes
// only on a Monday whose plan came out empty («Esperar al lunes libre», owner's decision of
// 2026-11-17), but this batch runs every day: without this, a sale on Monday could turn
// Tuesday's retry into `ventas_resumen` and put a second message in the same Monday slot.
// Unknown (217 not run, or the read failed) means «nobody»: before 217 there are no nudges.
async function nudgedThisWeek(now: Date): Promise<Set<string>> {
  const monday = new Date(now.getTime() - 5 * 3_600_000);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const { data, error } = await createServiceClient().rpc("inactivity_nudged_owners", {
    p_since: monday.toISOString().slice(0, 10),
  });
  if (error) {
    if (!/does not exist|Could not find/i.test(error.message)) {
      console.error("inactivity_nudged_owners:", error.message);
    }
    return new Set();
  }
  return new Set(((data ?? []) as unknown[]).map((r) => String(typeof r === "string" ? r : Object.values(r as object)[0])));
}

async function runBatch(
  day: "monday" | "thursday",
  now = new Date(),
  // Filled with the owners whose Monday plan came out empty: the ones an inactivity nudge may
  // use. Ids stay in memory; they never reach the batch result, which goes out over HTTP.
  quietMondays?: Set<string>,
): Promise<WeeklyBatchResult> {
  const periodo = claveSemanal(now);
  const targets = await loadTargets(periodo, previousWeekKey(now));
  const nudged = day === "monday" ? await nudgedThisWeek(now) : new Set<string>();
  const result: WeeklyBatchResult = {
    periodo,
    destinatarios: targets.length,
    enviados: 0,
    omitidos: 0,
    fallidos: 0,
    saltados: {},
    porPlantilla: {},
    cierreSaltados: {},
    cierreExtraordinarios: 0,
  };
  const closesSent = day === "thursday" ? await monthlyClosesSent(targets, now) : new Set<string>();

  // What THIS run sent to each number. The database count was read once, before the loop.
  const sentByPhone = new Map<string, number>();

  for (const t of targets) {
    const sentOnPhone = sentByPhone.get(t.whatsapp) ?? 0;
    const plan: Plan =
      day === "monday" && nudged.has(t.owner_id)
        ? { skip: "cita_usada" }
        : day === "monday"
          ? mondayPlan(t, sentOnPhone)
          : thursdayPlan(t, sentOnPhone);
    if ("skip" in plan) {
      // Only these two mean «this Monday has nothing to say». Every other skip is a slot
      // already used, a phone at its cap or a paused account, and none of those is free.
      if (day === "monday" && (plan.skip === "cuenta_vacia" || plan.skip === "estado_detenido")) {
        quietMondays?.add(t.owner_id);
      }
      result.saltados[plan.skip] = (result.saltados[plan.skip] ?? 0) + 1;
      if (day === "thursday") await sendMonthlyClose(t, plan, closesSent, periodo, now, sentByPhone, result);
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
    if (day === "thursday") await sendMonthlyClose(t, plan, closesSent, periodo, now, sentByPhone, result);
  }

  return result;
}

// Owners who already got this month's close, or have it on its way (ok not false), counted
// from the first day of the month of this week's Thursday at their own business. One read for
// the whole batch. A failed send (ok false) does not count, so the next run in the window
// retries it.
async function monthlyClosesSent(targets: WeeklyTarget[], now: Date): Promise<Set<string>> {
  const starts = new Map<string, number>();
  for (const t of targets) {
    const th = juevesDeLaSemana(now, t.country);
    starts.set(t.owner_id, startOfMonthUtc(th.year, th.month, t.country).getTime());
  }
  if (!starts.size) return new Set();
  const earliest = new Date(Math.min(...starts.values())).toISOString();
  // THROUGH A FUNCTION, NOT THE TABLE: production gives the service role no SELECT on
  // `whatsapp_sends` (migration 213). Read straight from the table, this failed there on every
  // run and the fallback below turned that into «everyone already has it»: no close, ever.
  const { data, error } = await createServiceClient().rpc("whatsapp_monthly_closes_sent", {
    p_since: earliest,
  });
  if (error) {
    // Unknown means «maybe sent»: a close sent twice cannot be taken back, one skipped can.
    console.error("cierre_mensual: envíos del mes:", error.message);
    return new Set(targets.map((t) => t.owner_id));
  }
  const out = new Set<string>();
  for (const row of (data ?? []) as { owner_id: string; sent_at: string }[]) {
    const start = starts.get(row.owner_id as string);
    if (start != null && new Date(row.sent_at as string).getTime() >= start) out.add(row.owner_id as string);
  }
  return out;
}

// `cierre_mensual`, after the owner's Thursday plan is settled: in the Thursday slot when that
// plan stayed quiet, or as a third message on the second Thursday (`monthlyClosePlan`). The
// month's figures are read only when nothing cheaper already rules it out.
async function sendMonthlyClose(
  t: WeeklyTarget,
  thursday: Plan,
  closesSent: Set<string>,
  periodo: string,
  now: Date,
  sentByPhone: Map<string, number>,
  result: WeeklyBatchResult,
): Promise<void> {
  const th = juevesDeLaSemana(now, t.country);
  const alreadySent = closesSent.has(t.owner_id);
  let cierre: CierreDelMes | null = null;
  if (!t.paused && !t.is_test && th.day <= 14 && !alreadySent) {
    try {
      cierre = await cargarCierreDelMesServidor(createServiceClient(), t.owner_id, t.country, mesAnteriorA(th.year, th.month, t.country));
    } catch (e) {
      console.error(`[cierre_mensual] ${t.owner_id}:`, e instanceof Error ? e.message : e);
      result.cierreSaltados.error_lectura = (result.cierreSaltados.error_lectura ?? 0) + 1;
      return;
    }
  }

  const sentOnPhone = sentByPhone.get(t.whatsapp) ?? 0;
  const plan = monthlyClosePlan(t, thursday, { thursdayDay: th.day, alreadySent, cierre }, sentOnPhone);
  if ("skip" in plan) {
    result.cierreSaltados[plan.skip] = (result.cierreSaltados[plan.skip] ?? 0) + 1;
    return;
  }

  let r: ResultadoEnvio;
  try {
    r = await enviarAvisoAlDueno({
      ownerId: t.owner_id,
      to: t.whatsapp,
      plantilla: plan.template,
      periodKey: periodo,
      parametrosCuerpo: plan.params,
      // Fixed URL button «Ver mi margen» (`qa/plantillas-esperadas.mjs`): nothing goes with it.
    });
  } catch (e) {
    console.error(`[cierre_mensual] ${t.owner_id}:`, e instanceof Error ? e.message : e);
    r = { estado: "fallido", error: "excepcion" };
  }
  if (r.estado === "enviado") {
    result.enviados += 1;
    result.porPlantilla[plan.template] = (result.porPlantilla[plan.template] ?? 0) + 1;
    closesSent.add(t.owner_id);
    if (plan.extraordinary) result.cierreExtraordinarios += 1;
    // Inside the slot it counts against the phone's two; as a third message it does not.
    else sentByPhone.set(t.whatsapp, sentOnPhone + 1);
  } else if (r.estado === "omitido") {
    result.omitidos += 1;
  } else {
    result.fallidos += 1;
  }
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
export function sendMondayMessages(now = new Date(), quietMondays?: Set<string>): Promise<WeeklyBatchResult> {
  return runBatch("monday", now, quietMondays);
}

/** Thursday onwards; the Thursday slot check decides whether anything goes out. */
export function sendThursdayMessages(now = new Date()): Promise<WeeklyBatchResult> {
  return runBatch("thursday", now);
}
