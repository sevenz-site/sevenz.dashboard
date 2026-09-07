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
  // Both are required everywhere a client is created, so editing can't be a
  // back door that empties them again.
  if (!whatsapp) return { error: "Escribe el WhatsApp del cliente.", success: false };
  if (!documentId) return { error: "Escribe la cédula o documento del cliente.", success: false };

  // document_country is deliberately absent from this update: it's inherited
  // from the owner at creation and no longer editable in the UI, so listing
  // it here would wipe the stored value to null on every save.
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      whatsapp,
      document_id: documentId,
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

// ── Papelera ────────────────────────────────────────────────────────────
// Two hiding states, both reversible in the database and neither one a
// delete: the row, its movements, its flags and its share link all survive.
// See PAPELERA-PLAN.md — the wording is "Mover a papelera" and "Ocultar
// definitivamente", never "Eliminar", because an owner who clicks Eliminar and
// later finds their "deleted" client still viewing a live balance has been
// misled by the button.

export type HideClientState = { error: string | null };

// Every screen that can show or count a client. Trashing changes what all of
// them display, and Next caches each one independently.
function revalidateClientSurfaces(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/malas-pagas");
  revalidatePath("/papelera");
  revalidatePath("/notificaciones");
}

export async function trashClient(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!clientId) return { error: "Cliente inválido." };

  // Ownership checked explicitly rather than left to RLS, per CLAUDE.md —
  // clientId arrives from the browser. Reading trashed_at in the same query
  // also makes a double-submit a no-op instead of a second snapshot.
  const { data: client } = await supabase
    .from("clients")
    .select("id, trashed_at")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };
  if (client.trashed_at) return { error: null };

  // The balance is snapshotted here, not derived later: once the client is
  // hidden, "Capital por cobrar" drops by this amount, and this row is the
  // only thing that can later explain the drop. Read from client_summary_all
  // because client_summary is about to stop returning this client — though at
  // this instant it still would, the unfiltered view is the honest source and
  // survives a retry after a partial failure.
  const { data: summary } = await supabase
    .from("client_summary_all")
    .select("balance, balance_usd, balance_eur")
    .eq("client_id", clientId)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      trashed_at: new Date().toISOString(),
      trashed_balance: summary?.balance ?? 0,
      trashed_balance_usd: summary?.balance_usd ?? 0,
      trashed_balance_eur: summary?.balance_eur ?? 0,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: `No pudimos mover el cliente a la papelera: ${updateError.message}` };
  }

  // The notification is the undo path, the same way movement_deletions is for
  // a deleted movement. A failure to write it leaves the client correctly
  // trashed with no way back from the notifications screen — recoverable from
  // the Papelera itself, so it is logged rather than surfaced as an error the
  // owner cannot act on.
  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "trashed",
  });
  if (hideError) console.error("trashClient: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}

export async function restoreClient(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!clientId) return { error: "Cliente inválido." };

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };

  // Clears both states at once, so restoring works from the Papelera and from
  // a permanently hidden client alike. is_flagged is deliberately untouched:
  // a client who was mala paga when they were trashed comes back mala paga.
  // The snapshot is cleared because it now has nothing to explain — the
  // balance is back in the totals it left.
  const { error } = await supabase
    .from("clients")
    .update({
      trashed_at: null,
      deleted_at: null,
      trashed_balance: null,
      trashed_balance_usd: null,
      trashed_balance_eur: null,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (error) {
    return { error: `No pudimos restaurar el cliente: ${error.message}` };
  }

  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "restored",
  });
  if (hideError) console.error("restoreClient: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}

export async function hideClientPermanently(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!clientId) return { error: "Cliente inválido." };

  const { data: client } = await supabase
    .from("clients")
    .select("id, trashed_at, deleted_at")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };
  if (client.deleted_at) return { error: null };
  // Reachable only from the Papelera, so the owner has already seen this
  // client once in a list titled "Papelera" before hiding them for good. A
  // one-step path from a client's own screen straight to the state nobody can
  // undo is exactly the button people click by accident.
  if (!client.trashed_at) {
    return { error: "Primero mueve el cliente a la papelera." };
  }

  // trashed_at is left in place. It is when the client left the totals, which
  // is the date a report needs; deleted_at only records when they stopped
  // being listed in the Papelera.
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (error) {
    return { error: `No pudimos ocultar el cliente: ${error.message}` };
  }

  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "hidden",
  });
  if (hideError) console.error("hideClientPermanently: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}
