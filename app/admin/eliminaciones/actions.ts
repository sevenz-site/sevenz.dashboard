"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/admin/guard";
import { runAccountDeletion } from "@/lib/admin/account-deletions";

export type BorrarState = { error: string | null; ok: boolean; resumen: string | null };

// «Borrar ahora» (PL-48 step 1.3). The guard runs here again and not only in the layout: this
// is a POST endpoint anyone could call without the page. The typed business name is checked on
// the server too (owner's decision of 2026-11-28: «Escribir el nombre del negocio»), so a
// request that skips the dialog still has to know it.
export async function accionBorrarCuenta(_prev: BorrarState, formData: FormData): Promise<BorrarState> {
  const { email } = await requireSuperadmin();
  const requestId = String(formData.get("request_id") ?? "");
  const typedName = String(formData.get("business_name") ?? "");
  if (!requestId) return { error: "Falta el pedido.", ok: false, resumen: null };

  const r = await runAccountDeletion({ requestId, typedName, adminEmail: email });
  revalidatePath("/admin/eliminaciones");
  revalidatePath("/admin/cuentas");
  if (!r.ok) return { error: r.error, ok: false, resumen: null };
  const filas = Object.values(r.deleted).reduce((a, b) => a + b, 0);
  return { error: null, ok: true, resumen: `Cuenta eliminada: ${filas} registros y ${r.files} archivos borrados.` };
}
