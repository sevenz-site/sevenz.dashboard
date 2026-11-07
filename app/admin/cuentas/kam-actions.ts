"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/admin/guard";
import { lastCoveredDay, proposeCommission } from "@/lib/admin/commission";
import { getAccountCommercial } from "@/lib/admin/kam";
import { borrarComprobante, subirComprobante } from "@/lib/admin/subscriptions";
import { trackServer } from "@/lib/mixpanel-server";
import { createServiceClient } from "@/lib/supabase/service";
import type { AccionState } from "@/app/admin/cuentas/actions";

// THE KAM'S SERVER ACTIONS (the owner's request of 2026-11-07). Each one calls
// requireSuperadmin() first: an action is a POST anyone can send without passing
// through the layout. The ids that arrive from the browser are checked again inside
// the functions of migration 198, which refuse a commission of another account.
//
// The error text is written here and not taken from Postgres: these are decisions a
// person has to act on, and each has its own sentence.

type RpcResult = {
  ok?: boolean;
  code?: string;
  evento_id?: string;
  action?: "kam_assigned" | "kam_changed" | "kam_removed";
};

const REJECTED: Record<string, string> = {
  no_account: "No encontramos esa cuenta.",
  no_kam: "No encontramos ese KAM.",
  same_kam: "Ese ya es el KAM de esta cuenta.",
  email_taken: "Ya hay un KAM con ese correo. Búscalo en la lista.",
  bad_dates: "La fecha final no puede ser anterior a la de inicio.",
  bad_amount: "El monto tiene que ser mayor que cero.",
  bad_payment: "Falta la fecha o cómo se pagó.",
  already_open: "Esta cuenta ya tiene una comisión en curso.",
  no_commission: "No encontramos esa comisión.",
  overlaps: "Ese día todavía lo cubre el acuerdo anterior. Elige una fecha posterior.",
  bad_kind: "Elige el tipo de feedback.",
  bad_body: "Escribe qué dijo, en menos de 2.000 letras.",
};

function reject(r: RpcResult | null, fallback: string): AccionState {
  return { error: (r?.code && REJECTED[r.code]) || fallback, ok: false };
}

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function kamFields(fd: FormData): { error: string } | { first: string; last: string; email: string; city: string; phone: string } {
  const first = text(fd, "first_name");
  const last = text(fd, "last_name");
  const email = text(fd, "email").toLowerCase();
  if (!first || !last) return { error: "Escribe el nombre y el apellido." };
  if (first.length > 80 || last.length > 80) return { error: "El nombre o el apellido son demasiado largos." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Escribe un correo válido." };
  return { first, last, email, city: text(fd, "city").slice(0, 120), phone: text(fd, "phone").slice(0, 40) };
}

function refresh(ownerId: string) {
  revalidatePath(`/admin/cuentas/${ownerId}`);
  revalidatePath("/admin/cuentas");
}

async function assign(ownerId: string, kamId: string | null, actor: string): Promise<AccionState> {
  const { data, error } = await createServiceClient().rpc("admin_kam_assign", {
    p_owner: ownerId,
    p_kam: kamId,
    p_actor_email: actor,
  });
  const r = data as RpcResult | null;
  if (error || !r?.ok) {
    if (error) console.error("[admin] admin_kam_assign:", error.message);
    return reject(r, "No pudimos guardar el KAM.");
  }
  // DO ACCOUNTS WITH A KAM PAY AND STAY MORE THAN ACCOUNTS WITHOUT ONE? It is the
  // question behind the commercial push of 2026-11-07: «Empezaré con la parte comercial
  // del proyecto a través de KAMS». Filed under the business, so a cohort of accounts
  // that received this event compares against the rest. If they pay the same, the
  // commission is cost with no return. `kam_changed` growing means accounts are being
  // passed around, and each pass closes an agreement early. Nothing of the KAM travels.
  if (r.action) trackServer("KAM Assignment Changed", ownerId, { action: r.action });
  refresh(ownerId);
  return { error: null, ok: true };
}

export async function accionAsignarKam(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  const removing = text(formData, "dejar_sin_kam") === "1";
  const kamId = removing ? null : text(formData, "kam_id");
  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  if (!removing && !kamId) return { error: "Elige un KAM de la lista.", ok: false };
  return assign(ownerId, kamId, email);
}

export async function accionCrearKam(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  const f = kamFields(formData);
  if ("error" in f) return { error: f.error, ok: false };

  const { data, error } = await createServiceClient().rpc("admin_kam_create", {
    p_first_name: f.first,
    p_last_name: f.last,
    p_email: f.email,
    p_city: f.city,
    p_phone: f.phone,
  });
  const r = data as (RpcResult & { kam_id?: string }) | null;
  if (error || !r?.ok || !r.kam_id) {
    if (error) console.error("[admin] admin_kam_create:", error.message);
    return reject(r, "No pudimos crear el KAM.");
  }
  return assign(ownerId, r.kam_id, email);
}

export async function accionEditarKam(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  const kamId = text(formData, "kam_id");
  if (!ownerId || !kamId) return { error: "Falta el KAM.", ok: false };
  const f = kamFields(formData);
  if ("error" in f) return { error: f.error, ok: false };

  const { data, error } = await createServiceClient().rpc("admin_kam_update", {
    p_kam: kamId,
    p_first_name: f.first,
    p_last_name: f.last,
    p_email: f.email,
    p_city: f.city,
    p_phone: f.phone,
    p_actor_email: email,
  });
  const r = data as RpcResult | null;
  if (error || !r?.ok) {
    if (error) console.error("[admin] admin_kam_update:", error.message);
    return reject(r, "No pudimos guardar los datos.");
  }
  refresh(ownerId);
  return { error: null, ok: true };
}

export async function accionGuardarComision(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  const commissionId = text(formData, "commission_id") || null;
  const startsOn = text(formData, "starts_on");
  const endsOn = text(formData, "ends_on");
  const amount = Number(text(formData, "amount"));

  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  if (!isDate(startsOn) || !isDate(endsOn)) return { error: "Faltan las fechas.", ok: false };
  if (!Number.isFinite(amount) || amount <= 0) return { error: REJECTED.bad_amount, ok: false };

  // The base and the period are read here, never taken from the form: they decide
  // how much every future payment generates, and the browser does not get a vote.
  const account = await getAccountCommercial(ownerId);
  if (!account) return { error: REJECTED.no_account, ok: false };
  const proposal = proposeCommission({
    today: account.today,
    demoEndsOn: account.demo_ends_on,
    paidUntilOn: account.paid_until_on,
    priceUsd: account.price_usd,
    periodicity: account.periodicidad,
    catalogProUsd: account.catalog_pro_usd,
    lastEndOn: lastCoveredDay(account.commissions),
  });

  const { data, error } = await createServiceClient().rpc("admin_commission_save", {
    p_owner: ownerId,
    p_commission: commissionId,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_amount_usd: amount,
    p_base_price_usd: proposal.basePriceUsd,
    p_periodicidad: proposal.periodicity,
    p_source_demo_ends_on: account.demo_ends_on,
    p_actor_email: email,
  });
  const r = data as RpcResult | null;
  if (error || !r?.ok) {
    if (error) console.error("[admin] admin_commission_save:", error.message);
    return reject(r, "No pudimos guardar la comisión.");
  }
  refresh(ownerId);
  return { error: null, ok: true };
}

// The evidence goes up AFTER the line exists, the order `adjunta` keeps in
// `actions.ts`: failing first would leave a file nothing names.
async function attach(ownerId: string, eventId: string | undefined, formData: FormData): Promise<string | null> {
  const file = formData.get("comprobante");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!eventId) return "Se guardó, pero no supimos a qué línea pegar el archivo.";

  const { path, error } = await subirComprobante(ownerId, file);
  if (error || !path) return `Se guardó, pero el archivo no subió: ${error ?? "error desconocido"}`;

  const { data, error: attachError } = await createServiceClient().rpc("admin_commercial_attach", {
    p_event: eventId,
    p_path: path,
  });
  if (attachError || !(data as RpcResult | null)?.ok) {
    await borrarComprobante(path);
    return "Se guardó, pero no pudimos adjuntar el archivo.";
  }
  return null;
}

export async function accionPagarKam(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  const commissionId = text(formData, "commission_id");
  const paidOn = text(formData, "paid_on");
  const method = text(formData, "method");
  const amount = Number(text(formData, "amount"));

  if (!ownerId || !commissionId) return { error: REJECTED.no_commission, ok: false };
  if (!Number.isFinite(amount) || amount <= 0) return { error: REJECTED.bad_amount, ok: false };
  if (!isDate(paidOn) || !method) return { error: REJECTED.bad_payment, ok: false };

  const { data, error } = await createServiceClient().rpc("admin_commission_pay", {
    p_owner: ownerId,
    p_commission: commissionId,
    p_paid_on: paidOn,
    p_amount_usd: amount,
    p_method: method,
    p_note: text(formData, "note").slice(0, 500),
    p_actor_email: email,
  });
  const r = data as RpcResult | null;
  if (error || !r?.ok) {
    if (error) console.error("[admin] admin_commission_pay:", error.message);
    return reject(r, "No pudimos registrar el pago.");
  }
  const aviso = await attach(ownerId, r.evento_id, formData);
  refresh(ownerId);
  return { error: null, ok: true, aviso };
}

export async function accionRegistrarFeedback(_prev: AccionState, formData: FormData): Promise<AccionState> {
  const { email } = await requireSuperadmin();
  const ownerId = text(formData, "owner_id");
  const kind = text(formData, "kind");
  const body = text(formData, "body");
  if (!ownerId) return { error: "Falta el negocio.", ok: false };

  const { data, error } = await createServiceClient().rpc("admin_feedback_add", {
    p_owner: ownerId,
    p_kind: kind,
    p_body: body,
    p_actor_email: email,
  });
  const r = data as RpcResult | null;
  if (error || !r?.ok) {
    if (error) console.error("[admin] admin_feedback_add:", error.message);
    return reject(r, "No pudimos guardar el feedback.");
  }
  const aviso = await attach(ownerId, r.evento_id, formData);
  // WHAT ARE THE BUSINESSES TELLING THEIR KAM, ACROSS ALL OF THEM? Complaints against
  // suggestions per month says whether the team is putting out fires or collecting
  // ideas, which no single account's page can show. The text never travels, only its
  // type. Filed under the business.
  trackServer("Account Feedback Logged", ownerId, {
    kind: kind as "complaint" | "suggestion" | "praise" | "question",
    has_attachment: formData.get("comprobante") instanceof File,
  });
  refresh(ownerId);
  return { error: null, ok: true, aviso };
}
