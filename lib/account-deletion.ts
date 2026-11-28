import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { sendEmail } from "@/lib/email/resend";
import { formatDateLong, zonaDelNegocio } from "@/lib/format";
import { logSecurityAudit } from "@/lib/security/second-factor";
import { maskEmail } from "@/lib/security/code-text";

// DELETING AN ACCOUNT, ON REQUEST (PL-48, step 1.3; migration 227). The owner asks from Mi
// negocio, confirms with a code sent to the account email, and the account keeps working
// for DELETION_GRACE_DAYS so a request made by mistake costs nothing. The deletion itself is
// run later by the Sevenz owner from /admin (owner's decision of 2026-11-27), not by a job.

// Owner's decision of 2026-11-20: «Margen de 30 días para eliminar la cuenta».
export const DELETION_GRACE_DAYS = 30;

/**
 * Owners with an open deletion request, for the WhatsApp senders that must skip them (owner's
 * decision of 2026-11-27: the Monday and Thursday messages stop during the 30 days).
 *
 * IF IT CANNOT BE READ, NOBODY IS SKIPPED, on purpose: in production before migration 227
 * runs, or on a failed read, the senders behave exactly as before. A missed «stop» costs one
 * message to somebody leaving; a failure that stopped the batch would cost every owner's.
 */
export async function ownersPendingDeletion(): Promise<Set<string>> {
  const { data, error } = await createServiceClient().rpc("owners_pending_deletion");
  if (error) {
    console.error("owners_pending_deletion:", error.message);
    return new Set();
  }
  // A `setof uuid` comes back as bare values; the object form is accepted too, in case
  // PostgREST wraps it under the function's name.
  return new Set(
    ((data ?? []) as unknown[]).map((v) =>
      v && typeof v === "object" ? String(Object.values(v as Record<string, unknown>)[0]) : String(v),
    ),
  );
}

export type RecordedDeletion = { ok: true; date: string; already: boolean } | { ok: false };

/**
 * Records the request once the owner proved the code, from either door: Mi negocio
 * (`source: "app"`) or the web page without the app (`"web"`). ONE function for both, so the
 * audit line, the event and the confirmation email cannot drift apart between them.
 *
 * `date` comes back written («27 de diciembre de 2026», in the business's zone). A second
 * request while one is open does not move it (`already`), and sends nothing new.
 *
 * BUSINESS QUESTION (PL-48, 2026-11-27): «¿cuántos tenderos piden borrar su cuenta, y cuántos
 * se arrepienten antes de los 30 días?». If requests grow, it is a churn signal to go and ask
 * why; if most are cancelled, the door is being reached by mistake. `source` says which door.
 * Filed under the owner, from the server: exact counts, never a floor.
 */
export async function recordDeletionRequest(opciones: {
  ownerId: string;
  email: string | null;
  source: "app" | "web";
}): Promise<RecordedDeletion> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("request_account_deletion", {
    p_owner_id: opciones.ownerId,
    p_source: opciones.source,
    p_days: DELETION_GRACE_DAYS,
  });
  const r = data as { ok?: boolean; already?: boolean; scheduled_for?: string } | null;
  if (error || !r?.ok || !r.scheduled_for) {
    console.error("[eliminar cuenta] request_account_deletion:", error?.message ?? JSON.stringify(r));
    return { ok: false };
  }

  const { data: owner } = await service.from("owners").select("country").eq("id", opciones.ownerId).maybeSingle();
  const date = formatDateLong(r.scheduled_for, zonaDelNegocio(owner?.country));

  if (!r.already) {
    await logSecurityAudit(opciones.ownerId, "account_deletion_requested", "owner", { scheduled_for: r.scheduled_for, source: opciones.source });
    trackServer("Account Deletion Requested", opciones.ownerId, { source: opciones.source }, opciones.email ?? undefined);
    // A written record for the owner, and the alarm if it was not him: anyone asking still
    // needed this inbox for the code, but the email says how to undo it either way. Plain
    // text, no links, like every account email (owner's rule of 2026-11-05).
    if (opciones.email) {
      const mail = await sendEmail({
        to: opciones.email,
        subject: "Pediste eliminar tu cuenta de Sevenz",
        text: [
          `Recibimos tu pedido para eliminar tu cuenta de Sevenz (${maskEmail(opciones.email)}).`,
          "",
          `Se eliminará el ${date}. Hasta ese día puedes seguir usándola con normalidad.`,
          "",
          "Si cambias de opinión, o si no fuiste tú, entra a Sevenz, abre Mi negocio y toca «Cancelar eliminación».",
        ].join("\n"),
        idempotencyKey: `account_deletion:${opciones.ownerId}:${r.scheduled_for}`,
        tag: "eliminar_cuenta",
      });
      if (!mail.ok) console.error("[eliminar cuenta] correo de confirmación:", mail.error);
    }
  }
  return { ok: true, date, already: Boolean(r.already) };
}
