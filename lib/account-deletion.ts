import { createServiceClient } from "@/lib/supabase/service";

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
