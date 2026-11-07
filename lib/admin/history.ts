import { maskEmail } from "@/lib/security/code-text";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";

// HOW EVERYTHING DONE TO AN ACCOUNT READS, in one place (point 4 of the owner's
// request of 2026-11-07: «se debe ver todo lo hecho con esa cuenta»).
//
// Three tables hold the facts and none of them is going to swallow the others:
// `subscription_events` feeds the income chart, `owner_security_audit` is written
// by the shopkeeper's own flows, and `account_commercial_events` is new in 198.
// So they are merged here, by date, and each row becomes a sentence: this screen
// is opened when someone disputes a charge, and what is needed there is reading.
//
// Pure: the «Seguridad» card uses `auditTitle` too, so the same action cannot read
// one way there and another in the history, and `qa:kam` runs this with no server.

export const METODO: Record<string, string> = {
  pago_movil: "Pago Móvil",
  zelle: "Zelle",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
};

const ESTADO: Record<string, string> = {
  demo: "Demo",
  activa: "Activa",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

export const FEEDBACK_KIND: Record<string, string> = {
  complaint: "Queja",
  suggestion: "Sugerencia",
  praise: "Elogio",
  question: "Duda",
};

// Calendar dates arrive as `YYYY-MM-DD` and must not move with the reader's zone.
export function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

export const usd = (amount: number) => formatDisplayCurrency(amount, "USD");

export type PlanEvent = {
  id: string;
  ocurrido_el: string;
  actor_email: string | null;
  desde_estado: string | null;
  hasta_estado: string | null;
  desde_plan: string | null;
  hasta_plan: string | null;
  motivo: string | null;
  metodo_pago: string | null;
  monto_usd: number | null;
  comprobante_path: string | null;
};

export type SecurityEvent = { id?: string; action: string; actor: string; at: string; detail: Record<string, unknown> };

export type CommercialEvent = {
  id: string;
  action: string;
  actor_email: string | null;
  detail: Record<string, unknown>;
  proof_path: string | null;
  at: string;
};

export type HistoryItem = { key: string; at: string; title: string; detail: string | null; proofPath: string | null };

const AUDIT: Record<string, string> = {
  email_changed_by_admin: "Correo cambiado por Sevenz",
  email_change_identity_note: "Identidad comprobada por otra vía",
  recovery_email_resent: "Correo para recuperar contraseña reenviado",
  identity_code_sent: "Código de identidad enviado al WhatsApp",
  identity_code_verified: "Código de identidad comprobado",
  second_factor_enabled: "Verificación en dos pasos activada",
  second_factor_disabled: "Verificación en dos pasos desactivada",
  whatsapp_changed: "Número de WhatsApp cambiado",
  password_changed: "Contraseña cambiada",
  password_changed_by_link: "Contraseña cambiada con el enlace del correo",
  not_me_confirmed: "«No fui yo»: sesiones cerradas",
  payment_method_changed: "Método de pago cambiado",
};

export function auditTitle(e: Pick<SecurityEvent, "action" | "detail">): string {
  if (e.action === "business_profile_changed") {
    const fields = Array.isArray(e.detail?.fields) ? e.detail.fields.join(", ") : "";
    return fields ? `Datos del negocio cambiados: ${fields}` : "Datos del negocio cambiados";
  }
  return AUDIT[e.action] ?? e.action;
}

// Who did it, and the facts behind it. An address is masked here even though this
// is /admin: the frames of v0.4.0 show it that way, and the current one is already
// at the top of the page.
export function auditDetail(e: Pick<SecurityEvent, "actor" | "detail">): string {
  const shown = (v: unknown) => (typeof v === "string" && v.includes("@") ? maskEmail(v) : String(v));
  const d = e.detail ?? {};
  const parts = [e.actor === "owner" ? "El dueño" : e.actor];
  if (typeof d.from === "string" && typeof d.to === "string") parts.push(`${shown(d.from)} → ${shown(d.to)}`);
  else if (typeof d.to === "string") parts.push(`a ${shown(d.to)}`);
  if (typeof d.target === "string") parts.push(d.target);
  if (typeof d.note === "string") parts.push(d.note);
  return parts.join(" · ");
}

// A line that changed neither plan nor state still says something: its reason.
// «Cambio sin efecto visible» stood here until 2026-11-07, over the test mark and
// the price change of 173, which are exactly what someone comes looking for.
function planTitle(e: PlanEvent): string {
  const cambioDePlan = e.desde_plan && e.hasta_plan && e.desde_plan !== e.hasta_plan;
  const cambioDeEstado = e.desde_estado && e.hasta_estado && e.desde_estado !== e.hasta_estado;
  if (e.monto_usd != null && e.metodo_pago) {
    return `Pagó ${usd(e.monto_usd)} por ${METODO[e.metodo_pago] ?? e.metodo_pago}`;
  }
  if (cambioDePlan) return `Cambió de ${e.desde_plan === "pro" ? "Pro" : "Free"} a ${e.hasta_plan === "pro" ? "Pro" : "Free"}`;
  if (cambioDeEstado) return `Pasó de ${ESTADO[e.desde_estado!] ?? e.desde_estado} a ${ESTADO[e.hasta_estado!] ?? e.hasta_estado}`;
  if (!e.desde_estado && e.hasta_estado) return "Cuenta creada en el sistema de planes";
  return e.motivo ?? "Cambio sin efecto visible";
}

function planDetail(e: PlanEvent, title: string): string {
  const facts = [e.actor_email ?? "—"];
  if (e.desde_estado !== e.hasta_estado) {
    facts.push(`${ESTADO[e.desde_estado ?? ""] ?? e.desde_estado ?? "—"} → ${ESTADO[e.hasta_estado ?? ""] ?? e.hasta_estado ?? "—"}`);
  }
  if (e.desde_plan !== e.hasta_plan) facts.push(`${e.desde_plan ?? "—"} → ${e.hasta_plan ?? "—"}`);
  const reason = e.motivo && e.motivo !== title ? `${e.motivo}\n` : "";
  return `${reason}${facts.join(" · ")}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export function commercialTitle(e: Pick<CommercialEvent, "action" | "detail">): string {
  const d = e.detail ?? {};
  const term = `${usd(num(d.amount_usd))} ${str(d.periodicidad)}, del ${formatYmd(str(d.starts_on))} al ${formatYmd(str(d.ends_on))}`;
  switch (e.action) {
    case "kam_assigned":
      return `KAM asignado: ${str(d.to)}`;
    case "kam_changed":
      return `KAM cambiado: ${str(d.from)} → ${str(d.to)}`;
    case "kam_removed":
      return `KAM quitado: ${str(d.from)}`;
    case "kam_updated":
      return `Datos del KAM cambiados: ${Array.isArray(d.fields) ? d.fields.join(", ") : ""}`;
    case "commission_created":
      return `Comisión registrada: ${term}`;
    case "commission_updated":
      return `Comisión editada: ${term}`;
    case "commission_closed":
      return `Comisión de ${str(d.kam_name)} cerrada el ${formatYmd(str(d.closed_on))}`;
    case "commission_paid":
      return `Pago a ${str(d.kam_name)}: ${usd(num(d.amount_usd))} por ${METODO[str(d.method)] ?? str(d.method)}`;
    case "feedback_logged":
      return `Feedback: ${FEEDBACK_KIND[str(d.kind)] ?? str(d.kind)}`;
    default:
      return e.action;
  }
}

function commercialDetail(e: CommercialEvent): string {
  const d = e.detail ?? {};
  const parts = [e.actor_email ?? "—"];
  if (["commission_created", "commission_updated", "kam_updated"].includes(e.action)) parts.push(`KAM: ${str(d.kam_name)}`);
  if (typeof d.note === "string" && d.note) parts.push(d.note);
  return parts.join(" · ");
}

export function mergeHistory(plan: PlanEvent[], security: SecurityEvent[], commercial: CommercialEvent[]): HistoryItem[] {
  const items: HistoryItem[] = [
    ...plan.map((e) => {
      const title = planTitle(e);
      return { key: `p-${e.id}`, at: e.ocurrido_el, title, detail: planDetail(e, title), proofPath: e.comprobante_path };
    }),
    ...security.map((e, i) => ({
      key: `s-${e.id ?? i}`,
      at: e.at,
      title: auditTitle(e),
      detail: auditDetail(e),
      proofPath: null,
    })),
    ...commercial.map((e) => ({
      key: `c-${e.id}`,
      at: e.at,
      title: commercialTitle(e),
      detail: commercialDetail(e),
      proofPath: e.proof_path,
    })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
