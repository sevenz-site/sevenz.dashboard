"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EditClientState = { error: string | null; success: boolean };

export async function updateClient(
  _prevState: EditClientState,
  formData: FormData,
): Promise<EditClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };

  const clientId = String(formData.get("client_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!clientId) return { error: "Cliente inválido.", success: false };
  if (!name) return { error: "El nombre no puede quedar vacío.", success: false };

  // document_country is deliberately absent from this update: it's inherited
  // from the owner at creation and no longer editable in the UI, so listing
  // it here would wipe the stored value to null on every save.
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      whatsapp: whatsapp || null,
      document_id: documentId || null,
      address: address || null,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);

  if (error) {
    return { error: `No pudimos guardar los cambios: ${error.message}`, success: false };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

export type FlagClientState = { error: string | null; success: boolean };

// Marks a client "Mala paga" — always requires a reason, logged in
// client_flags so the history survives even after the client is unflagged.
export async function flagClient(
  _prevState: FlagClientState,
  formData: FormData,
): Promise<FlagClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };

  const clientId = String(formData.get("client_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!clientId) return { error: "Cliente inválido.", success: false };
  if (!reason) return { error: "Escribe un motivo.", success: false };

  const { error: flagError } = await supabase.from("client_flags").insert({
    client_id: clientId,
    owner_id: user.id,
    reason,
  });
  if (flagError) {
    return { error: `No pudimos registrar la marca: ${flagError.message}`, success: false };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ is_flagged: true })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: `No pudimos marcar al cliente: ${updateError.message}`, success: false };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

// Reverses flagClient — no reason needed, immediate, same "restore" precedent
// as restoreMovement. The closed client_flags row stays as history.
export async function unflagClient(clientId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { error: closeError } = await supabase
    .from("client_flags")
    .update({ unflagged_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("owner_id", user.id)
    .is("unflagged_at", null);
  if (closeError) {
    return { error: `No pudimos quitar la marca: ${closeError.message}` };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ is_flagged: false })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: `No pudimos quitar la marca: ${updateError.message}` };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null };
}
