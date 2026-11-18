import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { claveSemanal, enviarAvisoAlDueno } from "@/lib/whatsapp/send";
import { templateSafe } from "@/lib/security/device-text";
import { APP_URL } from "@/lib/whatsapp/destinos";
import { sendEmail } from "@/lib/email/resend";
import { nudgeEmailText, nudgeOwnerName, nudgeTemplateFor } from "@/lib/inactivity-nudge/content";
import { unsubscribeToken } from "@/lib/inactivity-nudge/unsubscribe-token";

// THE INACTIVITY NUDGES (MS-53), from the daily cron, on Mondays only.
//
// Owner's decisions of 2026-11-17, each asked as a straight choice:
//   - the four approved templates in rotation, never `inactive_nudge_tax_invoice`;
//   - to a real account in trial, 15 days without registering, once every 3 weeks, until the
//     trial ends (who is due is `inactivity_nudge_targets`, migration 217);
//   - by WhatsApp to whoever accepted the notices, and by email, with one-click unsubscribe;
//   - «Esperar al lunes libre»: email and WhatsApp go together, on a Monday whose WhatsApp slot
//     stayed silent. An owner with the notices on whose Monday plan sent something (or tried to)
//     waits for the next free Monday; one without them has no WhatsApp Monday to wait for.
//
// WHAT THAT COSTS, said out loud: an inactive owner with something owed gets `negocio_resumen`
// every Monday, so his Monday is never free and he never gets a nudge, on either channel. The
// owner chose the rule knowing a busy Monday postpones the nudge; this is that, all the way.
//
// RESERVE, THEN SEND, THEN WRITE DOWN: the order of `send.ts`. The reserved row is unique per
// owner and Monday, so a second run the same day cannot send twice.
//
// NO EVENT OF ITS OWN for WhatsApp: `WhatsApp Message Sent` with the template's name already
// answers whether it went out. The email side is counted in `inactivity_nudges.email_status`.

type Target = {
  owner_id: string;
  email: string | null;
  whatsapp: string | null;
  whatsapp_ok: boolean;
  first_name: string | null;
  business_name: string | null;
  country: string | null;
  nudges_sent: number;
};

export type NudgeBatchResult = {
  candidatos: number;
  esperan: number;
  whatsapp: { enviados: number; fallidos: number; omitidos: number };
  correo: { enviados: number; fallidos: number; omitidos: number };
};

type ChannelStatus = "sent" | "failed" | "skipped";

// The email's sender: its own subdomain, never the one that sends login codes («Subdominio
// aparte», owner's decision of 2026-11-17). Until it is configured, no email goes.
function tipsSender(): string | null {
  return process.env.RESEND_TIPS_FROM?.trim() || null;
}

// Where the email's links point. Production's app unless told otherwise, so a test from the
// dev branch can point its unsubscribe link at the dev app instead.
function appBase(): string {
  return (process.env.APP_BASE_URL?.trim() || APP_URL).replace(/\/+$/, "");
}

/** Today's date in Colombia's zone, the day the cron calls «Monday». */
function cycleDate(now: Date): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

async function sendWhatsapp(t: Target, template: string, now: Date): Promise<ChannelStatus> {
  if (!t.whatsapp_ok || !t.whatsapp) return "skipped";
  try {
    const r = await enviarAvisoAlDueno({
      ownerId: t.owner_id,
      to: t.whatsapp,
      plantilla: template,
      periodKey: claveSemanal(now),
      // «hola» is what every owner template falls back to when no name is on file.
      parametrosCuerpo: [{ nombre: "owner_name", texto: templateSafe(nudgeOwnerName(t.first_name, t.business_name)) || "hola" }],
      // Static button «Abrir Sevenz» → https://app.sevenz.site/ (read back from Meta on
      // 2026-11-17): nothing goes with it.
    });
    return r.estado === "enviado" ? "sent" : r.estado === "fallido" ? "failed" : "skipped";
  } catch (e) {
    console.error(`[aviso inactividad] WhatsApp ${t.owner_id}:`, e instanceof Error ? e.message : e);
    return "failed";
  }
}

async function sendMail(t: Target, template: ReturnType<typeof nudgeTemplateFor>, cycle: string): Promise<ChannelStatus> {
  const from = tipsSender();
  const token = unsubscribeToken(t.owner_id);
  if (!from || !token || !t.email) return "skipped";
  const base = appBase();
  const { subject, text } = nudgeEmailText(
    template,
    nudgeOwnerName(t.first_name, t.business_name),
    base,
    `${base}/consejos/baja/${token}`,
  );
  const r = await sendEmail({
    to: t.email,
    subject,
    text,
    idempotencyKey: `nudge:${t.owner_id}:${cycle}`,
    tag: "inactivity_nudge",
    fromOverride: from,
    // RFC 8058 one-click: Gmail's and Yahoo's own «unsubscribe» button POSTs here, with no
    // page in between. The link in the body goes to a page with a button instead.
    headers: {
      "List-Unsubscribe": `<${base}/api/consejos/baja?t=${encodeURIComponent(token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  return r.ok ? "sent" : "failed";
}

/**
 * Mondays, after the Monday batch. `quietMondays` are the owners with the WhatsApp notices whose
 * Monday plan came out empty in that same run. Never throws: a nudge must not cost the cron.
 */
export async function sendInactivityNudges(
  quietMondays: Set<string>,
  now = new Date(),
  // Tests only (`qa:avisos-inactividad`): restrict the batch to the suite's own accounts, so it
  // can run in dev without writing to anybody else's. The cron never passes it.
  onlyOwners?: Set<string>,
): Promise<NudgeBatchResult> {
  const result: NudgeBatchResult = {
    candidatos: 0,
    esperan: 0,
    whatsapp: { enviados: 0, fallidos: 0, omitidos: 0 },
    correo: { enviados: 0, fallidos: 0, omitidos: 0 },
  };
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("inactivity_nudge_targets");
  if (error) {
    // Before 217 runs this function does not exist, and that is «no nudges yet», not a fault.
    if (!/does not exist|Could not find/i.test(error.message)) {
      console.error("[aviso inactividad] inactivity_nudge_targets:", error.message);
    }
    return result;
  }
  const targets = ((data ?? []) as Target[]).filter((t) => !onlyOwners || onlyOwners.has(t.owner_id));
  result.candidatos = targets.length;
  const cycle = cycleDate(now);

  for (const t of targets) {
    try {
      // «Esperar al lunes libre»: with the notices on, only a Monday whose plan said nothing.
      if (t.whatsapp_ok && !quietMondays.has(t.owner_id)) {
        result.esperan += 1;
        continue;
      }
      // Nothing to send on: no WhatsApp and no email configured. Reserving would burn his
      // 3-week turn for a nudge that never existed.
      const canEmail = Boolean(tipsSender() && unsubscribeToken(t.owner_id) && t.email);
      if (!t.whatsapp_ok && !canEmail) {
        result.correo.omitidos += 1;
        continue;
      }

      const template = nudgeTemplateFor(Number(t.nudges_sent ?? 0));
      const { data: id, error: reserveError } = await supabase.rpc("inactivity_nudge_reserve", {
        p_owner_id: t.owner_id,
        p_cycle_on: cycle,
        p_template: template,
      });
      if (reserveError) {
        console.error("[aviso inactividad] reserve:", reserveError.message);
        continue;
      }
      if (!id) continue; // already done this Monday

      const wa = await sendWhatsapp(t, template, now);
      const mail = await sendMail(t, template, cycle);
      result.whatsapp[wa === "sent" ? "enviados" : wa === "failed" ? "fallidos" : "omitidos"] += 1;
      result.correo[mail === "sent" ? "enviados" : mail === "failed" ? "fallidos" : "omitidos"] += 1;

      const { error: finishError } = await supabase.rpc("inactivity_nudge_finish", {
        p_id: id,
        p_whatsapp_status: wa,
        p_email_status: mail,
      });
      if (finishError) console.error("[aviso inactividad] finish:", finishError.message);
    } catch (e) {
      console.error(`[aviso inactividad] ${t.owner_id}:`, e instanceof Error ? e.message : e);
    }
  }
  return result;
}
