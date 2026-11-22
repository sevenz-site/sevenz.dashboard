import { createServiceClient } from "@/lib/supabase/service";
import { formatCurrency, zonaDelNegocio } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatBalanceSummaryOfBooks } from "@/lib/exchange-rate/movement-display";
import { estadosDelFiado, pagadoDelFiado } from "@/lib/estado-del-plazo";
import { enviarPlantilla } from "@/lib/whatsapp/kapso";

// THE CLIENT'S NOTICES PER CUOTA: `installment_due_soon` and `overdue_debt_warning`.
//
// Owner's request of 2026-11-19: *«que las notificaciones de whatsapp de plazo vencido salgan no
// del plazo vencido total sino de las cuotas»*. Both templates approved by Meta and compared with
// `../docs/WHATSAPP-PLANTILLAS.md` on 2026-11-22. They replace `payment_due_date_v2`, which said
// the whole balance next to a date that was only one cuota's (`CT-90`) and never looked at whether
// that cuota was paid. A fiado without cuotas is one cuota, and the text says «pago».
//
// PER CUOTA, THREE MESSAGES:
//
//   installment_due_soon   N days before the cuota falls due, N = clamp(round(cuota length × 0,25),
//                          1, 7) -- the owner's window of 2026-10-14, applied to the cuota since
//                          migration 120.
//   overdue_debt_warning   at 7 and at 15 days past the cuota's date, still unpaid. Never to a
//                          client already flagged as «mala paga»: the message says the business
//                          CAN flag them, and that already happened.
//
// WHICH CUOTA IS PAID IS DECIDED BY `estadosDelFiado` WITH `pagadoDelFiado`, exactly as the cuota
// table paints its «Estado» column. Owner's choice of 2026-11-22 («B»: the message says what the
// table says), and the same day the table itself was fixed («solución 1»): what a fiado has had
// paid is its stored amount minus what it still owes in the ledger's queue. So an undirected
// payment counts, and the payment made at the sale does not count twice (the fiado is already
// stored for what was left after it). Message, table and history chip agree, and all three agree
// with the ledger.
//
// ONE NOTICE PER CLIENT PER WEEK, across both templates (decision of 2026-11-19): the firm one
// before the early one, and the oldest cuota first. Cuotas a week apart make the early notice of
// one and the firm one of the previous fall the same week; the client gets one, on purpose. A
// notice the cap holds back is not sent later: each notice has one day, as the old reminder had.
// The receipt of a payment does not count against this cap (my reading, stated to the owner on
// 2026-11-22: it confirms a fact the shopkeeper just registered).
//
// THE DAY IS COUNTED IN THE BUSINESS'S ZONE (`zonaDelNegocio`, PL-1, migration 168): Caracas for
// Venezuela, Bogota for everyone else. «Today» and the cuota's date come from the same clock.
//
// IT IS A REMINDER FOR THE SEND GATE: `p_reminder: true`, so the cap of 20 per business per day
// applies and a fiado that came from a libreta photo is NOT held back (MS-27, MS-7).

export const TEMPLATE_DUE_SOON = "installment_due_soon";
export const TEMPLATE_OVERDUE = "overdue_debt_warning";

const OVERDUE_DAYS = [7, 15] as const;
const DAY_MS = 86_400_000;

export type CandidateRow = {
  movement_id: string;
  client_id: string;
  owner_id: string;
  created_at: string;
  amount: number | string;
  currency: "USD" | "EUR" | null;
  plazo_dias: number;
  cuotas: number | null;
  /** What this fiado still owes, from `get_open_charges_for_client` (migration 218). */
  pendiente: number | string;
  business_name: string;
  country: string | null;
  is_flagged: boolean;
  balance: number | string | null;
  balance_usd: number | string | null;
  balance_eur: number | string | null;
  ultimo_aviso: string | null;
};

export type NoticeKind = "soon" | "d7" | "d15";

export type PlannedNotice = {
  kind: NoticeKind;
  template: typeof TEMPLATE_DUE_SOON | typeof TEMPLATE_OVERDUE;
  movementId: string;
  clientId: string;
  ownerId: string;
  cuota: number;
  cuotas: number;
  /** The cuota's day in the business's zone, YYYY-MM-DD. */
  dueDay: string;
  /** Every body parameter except `client_name`, which is read fresh right before sending. */
  params: {
    installment: string;
    business_name: string;
    due_date?: string;
    days_overdue?: string;
    installment_due: string;
    amount_due: string;
  };
};

export type PlanResult = {
  notices: PlannedNotice[];
  /** Clients with something due today that the weekly cap held back. */
  heldByWeeklyCap: number;
  /** Overdue cuotas not sent because the client is already flagged. */
  heldByFlag: number;
};

// YYYY-MM-DD of an instant in a zone. `en-CA` writes that order natively.
function dayIn(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS);
}

// «15 de noviembre», in the business's zone. No year: the notice speaks about this week.
function longDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: tz }).format(instant);
}

function formatAmount(amount: number, currency: "USD" | "EUR" | null): string {
  return currency === null ? formatCurrency(amount) : formatDisplayCurrency(amount, currency);
}

// How early the early notice goes: a quarter of the cuota's length, between 1 and 7 days. The
// SQL of migrations 120 and 168 did `round(numeric)`, half away from zero; for these positive
// values `Math.round` gives the same day.
export function daysBefore(plazoDias: number, cuotas: number): number {
  return Math.max(1, Math.min(7, Math.round((plazoDias / cuotas) * 0.25)));
}

/**
 * Who gets which notice today. Pure: no database, no clock of its own, so the suite can feed it
 * invented fiados and a chosen «now».
 */
export function planInstallmentNotices(rows: CandidateRow[], now: Date): PlanResult {
  type Candidate = PlannedNotice & { createdAt: string };
  const byClient = new Map<string, Candidate[]>();
  const lastNotice = new Map<string, { at: string | null; tz: string }>();
  let heldByFlag = 0;

  for (const r of rows) {
    const tz = zonaDelNegocio(r.country);
    const today = dayIn(now, tz);
    const n = r.cuotas && r.cuotas > 1 ? r.cuotas : 1;
    const amount = Number(r.amount);

    const { cuotas } = estadosDelFiado({
      createdAt: r.created_at,
      plazoDias: r.plazo_dias,
      cuotas: n,
      amount,
      abonoInicial: pagadoDelFiado(amount, Number(r.pendiente ?? 0)),
      ahora: now,
    });

    const before = daysBefore(r.plazo_dias, n);
    const amountDue = formatBalanceSummaryOfBooks(
      Number(r.balance ?? 0),
      Number(r.balance_usd ?? 0),
      Number(r.balance_eur ?? 0),
      r.country === "VE",
    );

    for (const c of cuotas) {
      if (c.estado === "pagado" || c.pendiente <= 0.005) continue;
      const dueDay = dayIn(c.fecha, tz);

      let kind: NoticeKind | null = null;
      if (addDays(dueDay, -before) === today) kind = "soon";
      else if (addDays(dueDay, OVERDUE_DAYS[0]) === today) kind = "d7";
      else if (addDays(dueDay, OVERDUE_DAYS[1]) === today) kind = "d15";
      if (!kind) continue;

      if (kind !== "soon" && r.is_flagged) {
        heldByFlag++;
        continue;
      }

      const list = byClient.get(r.client_id) ?? [];
      list.push({
        kind,
        template: kind === "soon" ? TEMPLATE_DUE_SOON : TEMPLATE_OVERDUE,
        movementId: r.movement_id,
        clientId: r.client_id,
        ownerId: r.owner_id,
        cuota: c.numero,
        cuotas: n,
        dueDay,
        createdAt: r.created_at,
        params: {
          installment: n === 1 ? "pago" : `cuota ${c.numero} de ${n}`,
          business_name: r.business_name,
          ...(kind === "soon"
            ? { due_date: longDate(c.fecha, tz) }
            : { days_overdue: String(kind === "d7" ? OVERDUE_DAYS[0] : OVERDUE_DAYS[1]) }),
          installment_due: formatAmount(c.pendiente, r.currency),
          amount_due: amountDue,
        },
      });
      byClient.set(r.client_id, list);
    }
    lastNotice.set(r.client_id, { at: r.ultimo_aviso, tz });
  }

  const notices: PlannedNotice[] = [];
  let heldByWeeklyCap = 0;
  for (const [clientId, list] of byClient) {
    // THE WEEKLY CAP, counted in calendar days of the business: a notice sent last Monday blocks
    // until this Monday, whatever minute the cron ran each time.
    const last = lastNotice.get(clientId);
    if (last?.at && daysBetween(dayIn(new Date(last.at), last.tz), dayIn(now, last.tz)) < 7) {
      heldByWeeklyCap++;
      continue;
    }
    // The firm one first, then the oldest cuota, then the oldest fiado.
    list.sort(
      (a, b) =>
        Number(a.kind === "soon") - Number(b.kind === "soon") ||
        a.dueDay.localeCompare(b.dueDay) ||
        a.createdAt.localeCompare(b.createdAt),
    );
    const { createdAt: _createdAt, ...chosen } = list[0];
    void _createdAt;
    notices.push(chosen);
  }

  // Overdue before early across clients too: the shared daily caps of the send gate (MS-37) are
  // reached first by whoever is sent first, and the firm notice is the one that cannot wait.
  notices.sort((a, b) => Number(a.kind === "soon") - Number(b.kind === "soon"));
  return { notices, heldByWeeklyCap, heldByFlag };
}

export type InstallmentNoticesSummary = {
  candidatos: number;
  enviados: number;
  omitidos: Record<string, number>;
  fallidos: number;
};

type Target = {
  ok: boolean;
  reason?: string;
  client_name: string;
  phone: string;
  share_token: string | null;
};

function clientNoticesEnabled(): boolean {
  return process.env.WHATSAPP_CLIENT_NOTICES === "on";
}

export async function sendInstallmentNotices(now: Date = new Date()): Promise<InstallmentNoticesSummary> {
  const summary: InstallmentNoticesSummary = { candidatos: 0, enviados: 0, omitidos: {}, fallidos: 0 };
  const skip = (reason: string, n = 1) => {
    if (n > 0) summary.omitidos[reason] = (summary.omitidos[reason] ?? 0) + n;
  };

  if (!clientNoticesEnabled()) {
    skip("desactivado");
    return summary;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("whatsapp_cuotas_candidatas");
  if (error) {
    console.error("[avisos de cuota] candidatos:", error.message);
    throw new Error("No se pudo calcular a quién le toca el aviso de cuota.");
  }

  // A DATABASE WITH THE FIRST VERSION OF 218 RETURNS NO `pendiente`, and then every fiado would
  // read as paid and nothing would go out, with no error anywhere. Seen in dev on 2026-11-22, the
  // day 218 changed shape before being re-run. Loud instead of silent.
  const rows = (data ?? []) as CandidateRow[];
  if (rows.length > 0 && !("pendiente" in rows[0])) {
    console.error("[avisos de cuota] whatsapp_cuotas_candidatas no devuelve pendiente: la 218 de la base es la vieja");
    throw new Error("La función de candidatos de la base no está al día (migración 218).");
  }
  const plan = planInstallmentNotices(rows, now);
  summary.candidatos = plan.notices.length;
  skip("tope_semanal", plan.heldByWeeklyCap);
  skip("mala_paga", plan.heldByFlag);

  for (const n of plan.notices) {
    // ASKED AGAIN RIGHT BEFORE SENDING: between the list and this turn the client may have
    // withdrawn consent, been trashed or had the phone corrected. The list says who is DUE; this
    // says who CAN still be reached. `true` marks it as a reminder (MS-7).
    const { data: targetRaw, error: targetError } = await supabase.rpc("movement_notice_target", {
      p_movement_id: n.movementId,
      p_reminder: true,
    });
    if (targetError) {
      console.error("[avisos de cuota] movement_notice_target:", targetError.message);
      summary.fallidos++;
      continue;
    }
    const target = targetRaw as Target;
    if (!target?.ok) {
      skip(target?.reason ?? "desconocido");
      continue;
    }

    // The button needs a token and some clients never got a link (CT-1). Created through the same
    // function as the receipt: writing `share_links` with the service key works in dev and not in
    // production (migration 102).
    let token = target.share_token ?? "";
    if (token === "") {
      const { data: created, error: linkError } = await supabase.rpc("whatsapp_share_token_for_client", {
        p_client_id: n.clientId,
      });
      if (linkError || !created) {
        console.error("[avisos de cuota] no pude crear el enlace:", linkError?.message);
        summary.fallidos++;
        continue;
      }
      token = created as string;
    }

    // ONE SEND PER CUOTA AND PER NOTICE: running the cron twice the same day returns
    // `ya_enviado`, and the 7-day and 15-day notices of the same cuota have different keys.
    const { data: reservation, error: reservationError } = await supabase.rpc("whatsapp_send_begin", {
      p_owner_id: n.ownerId,
      p_template: n.template,
      p_period_key: `cuota:${n.movementId}:${n.cuota}:${n.kind}`,
      p_audience: "client",
      p_recipient: target.phone,
      p_client_id: n.clientId,
      p_movement_id: n.movementId,
      p_reminder: true,
    });
    if (reservationError) {
      console.error("[avisos de cuota] whatsapp_send_begin:", reservationError.message);
      summary.fallidos++;
      continue;
    }
    const r = reservation as { id?: string; skip?: string };
    if (r.skip) {
      skip(r.skip);
      continue;
    }

    // THE ORDER IS THE APPROVED ONE, and Meta rejects a whole message whose parameters it does
    // not recognise. `qa/plantillas-esperadas.mjs` holds the same lists.
    const body =
      n.kind === "soon"
        ? [
            { nombre: "client_name", texto: target.client_name },
            { nombre: "installment", texto: n.params.installment },
            { nombre: "business_name", texto: n.params.business_name },
            { nombre: "due_date", texto: n.params.due_date ?? "" },
            { nombre: "installment_due", texto: n.params.installment_due },
            { nombre: "amount_due", texto: n.params.amount_due },
          ]
        : [
            { nombre: "client_name", texto: target.client_name },
            { nombre: "installment", texto: n.params.installment },
            { nombre: "business_name", texto: n.params.business_name },
            { nombre: "days_overdue", texto: n.params.days_overdue ?? "" },
            { nombre: "installment_due", texto: n.params.installment_due },
            { nombre: "amount_due", texto: n.params.amount_due },
          ];

    const sent = await enviarPlantilla({
      audience: "client",
      ownerId: n.ownerId,
      to: target.phone,
      plantilla: n.template,
      parametrosCuerpo: body,
      parametroBoton: { nombre: "share_token", texto: token },
    });

    await supabase.rpc("whatsapp_send_finish", {
      p_id: r.id,
      p_ok: sent.ok,
      p_provider_message_id: sent.ok ? sent.messageId : null,
      p_error: sent.ok ? null : sent.error,
      p_phone_number_id: sent.phoneNumberId,
    });

    if (!sent.ok) {
      console.error(`[avisos de cuota] falló para ${n.clientId}:`, sent.error);
      summary.fallidos++;
      continue;
    }
    summary.enviados++;
  }

  return summary;
}
