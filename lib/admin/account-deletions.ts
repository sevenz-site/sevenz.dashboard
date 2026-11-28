import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// RUNNING AN ACCOUNT DELETION FROM /admin (PL-48 step 1.3; migrations 227 and 229). What goes
// and what stays, and why the default is «delete», is written at the top of migration 229.
//
// THE ORDER IS THE SAFETY. Each step fails into the state that hurts least:
//   1. CHECK: the request is open and due, and the admin typed the business name exactly.
//   2. CLOSE THE ACCESS: ban the auth user and swap its email for an unusable one. If anything
//      after this fails, the shopkeeper is locked out of an account whose data is all still
//      there, and «Borrar ahora» can simply run again. The reverse order (data first) could
//      leave an EMPTY business that its owner can still sign into.
//   3. FILES: everything under `<ownerId>/` in the four operational buckets, plus the legacy
//      client photos outside it. `comprobantes` is NOT touched: payments stay with their
//      receipts (owner's decision of 2026-11-28, «Guardar todo, comprobantes incluidos»), and
//      feedback attachments and commercial proofs live there too.
//   4. DATA: `admin_purge_account`, one transaction, which re-checks the request, deletes,
//      closes every session and marks the account «Eliminada».
// Files and data are retried as a whole by pressing again: step 2 is idempotent, step 3
// lists what is left, and step 4 refuses only a request already deleted or cancelled.

const OPERATIONAL_BUCKETS = ["logos", "attachments", "client-profile-pictures", "product-photos"] as const;
// Supabase lists at most this many per page.
const PAGE = 1000;
// 100 years: the Auth API's way of saying «never again».
const BAN_FOREVER = "876000h";

export type AccountDeletionRow = {
  request_id: string;
  owner_id: string;
  business_name: string | null;
  email: string | null;
  country: string | null;
  source: "app" | "web";
  requested_at: string;
  scheduled_for: string;
  cancelled_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

export async function listAccountDeletions(): Promise<{ rows: AccountDeletionRow[]; error: string | null }> {
  const { data, error } = await createServiceClient().rpc("admin_account_deletions");
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AccountDeletionRow[], error: null };
}

/** The same comparison the dialog shows: spaces at the ends and letter case do not count. */
export function sameBusinessName(typed: string, real: string | null): boolean {
  if (!real) return false;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return norm(typed) === norm(real);
}

async function removeFolder(bucket: string, prefix: string): Promise<{ removed: number; error: string | null }> {
  const storage = createServiceClient().storage.from(bucket);
  let removed = 0;
  // Folders nest (`<owner>/<sub>/file`): walk them, deepest first, so nothing is left behind.
  const pending: string[] = [prefix];
  while (pending.length) {
    const folder = pending.pop()!;
    for (;;) {
      const { data, error } = await storage.list(folder, { limit: PAGE });
      if (error) return { removed, error: `${bucket}/${folder}: ${error.message}` };
      if (!data?.length) break;
      const files = data.filter((o) => o.id !== null).map((o) => `${folder}/${o.name}`);
      for (const sub of data.filter((o) => o.id === null)) pending.push(`${folder}/${sub.name}`);
      if (!files.length) break;
      const { error: rmError } = await storage.remove(files);
      if (rmError) return { removed, error: `${bucket}: ${rmError.message}` };
      removed += files.length;
      if (data.length < PAGE) break;
    }
  }
  return { removed, error: null };
}

export type DeletionResult =
  | { ok: true; files: number; deleted: Record<string, number> }
  | { ok: false; error: string };

export async function runAccountDeletion(opciones: {
  requestId: string;
  typedName: string;
  adminEmail: string;
}): Promise<DeletionResult> {
  const service = createServiceClient();

  // 1. Check.
  const { data: check, error: checkError } = await service.rpc("admin_account_deletion_check", { p_request_id: opciones.requestId });
  if (checkError) return { ok: false, error: `No se pudo comprobar el pedido: ${checkError.message}` };
  const c = check as { ok?: boolean; code?: string; owner_id?: string; business_name?: string | null; legacy_paths?: string[] } | null;
  if (!c?.ok || !c.owner_id) {
    const reason: Record<string, string> = {
      not_found: "Ese pedido no existe.",
      cancelled: "El dueño canceló este pedido.",
      already_deleted: "Esta cuenta ya se eliminó.",
      not_due: "Todavía no se cumplen los 30 días.",
      no_owner: "La cuenta ya no existe.",
    };
    return { ok: false, error: reason[c?.code ?? ""] ?? "No se pudo comprobar el pedido." };
  }
  if (!sameBusinessName(opciones.typedName, c.business_name ?? null)) {
    return { ok: false, error: "El nombre no coincide con el del negocio." };
  }
  const ownerId = c.owner_id;

  // 2. Close the access.
  const { error: authError } = await service.auth.admin.updateUserById(ownerId, {
    email: `eliminada-${ownerId}@cuentas-eliminadas.sevenz.invalid`,
    email_confirm: true,
    ban_duration: BAN_FOREVER,
  });
  if (authError) return { ok: false, error: `No se pudo cerrar el acceso: ${authError.message}. No se borró nada.` };

  // 3. Files.
  let files = 0;
  for (const bucket of OPERATIONAL_BUCKETS) {
    const r = await removeFolder(bucket, ownerId);
    files += r.removed;
    if (r.error) {
      console.error("[eliminar cuenta] storage:", r.error);
      return { ok: false, error: `El acceso ya está cerrado, pero no se pudieron borrar todos los archivos (${r.error}). Vuelve a pulsar «Borrar ahora».` };
    }
  }
  const legacy = (c.legacy_paths ?? []).filter(Boolean);
  if (legacy.length) {
    const { error } = await service.storage.from("client-profile-pictures").remove(legacy);
    if (error) {
      console.error("[eliminar cuenta] fotos antiguas:", error.message);
      return { ok: false, error: `El acceso ya está cerrado, pero no se pudieron borrar ${legacy.length} fotos antiguas de clientes. Vuelve a pulsar «Borrar ahora».` };
    }
    files += legacy.length;
  }

  // 4. Data.
  const { data: purge, error: purgeError } = await service.rpc("admin_purge_account", {
    p_request_id: opciones.requestId,
    p_admin: opciones.adminEmail,
  });
  const p = purge as { ok?: boolean; code?: string; deleted?: Record<string, number> } | null;
  if (purgeError || !p?.ok) {
    console.error("[eliminar cuenta] purge:", purgeError?.message ?? JSON.stringify(p));
    return { ok: false, error: "El acceso y los archivos ya están borrados, pero los datos no. Vuelve a pulsar «Borrar ahora»." };
  }
  return { ok: true, files, deleted: p.deleted ?? {} };
}
