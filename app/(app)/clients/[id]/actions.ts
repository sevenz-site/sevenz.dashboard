"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { DOCUMENT_SOURCE } from "@/lib/types";

// TODAS LAS ACCIONES DE ESTE ARCHIVO ESCRIBEN EN `clients`, y la politica de
// la 061 se las rechaza a una cuenta pausada. Por eso cada una empieza
// preguntando si puede escribir, justo despues de comprobar la sesion.
//
// No sobra con dejar que la politica haga su trabajo: un update rechazado no
// devuelve error, afecta a cero filas. Marcar una mala paga o mandar un
// cliente a la papelera se veria como que funciono, y no habria pasado nada.

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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA, success: false };

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

  // THE ORIGIN IS ONLY TOUCHED WHEN THE DOCUMENT ACTUALLY CHANGES.
  //
  // This update rewrites `document_id` on every save, changed or not. Setting
  // the origin here without looking would downgrade to 'owner' a document the
  // client declared themselves, just because the shopkeeper edited the address
  // — silently, erasing the very thing the column exists to hold.
  //
  // It is the same failure the document_country comment warns about three lines
  // below. This file already learned it once.
  const { data: previous } = await supabase
    .from("clients")
    .select("document_id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();

  const documentChanged = (previous?.document_id ?? "").trim() !== documentId;

  // document_country is deliberately absent from this update: it's inherited
  // from the owner at creation and no longer editable in the UI, so listing
  // it here would wipe the stored value to null on every save.
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      whatsapp,
      document_id: documentId,
      ...(documentChanged ? { document_source: DOCUMENT_SOURCE.OWNER } : {}),
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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA, success: false };

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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };

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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
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
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
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

// Guarda la ruta de la foto que el navegador acaba de subir al bucket.
//
// La subida en sí la hace el navegador con la sesión del dueño, igual que las
// fotos de un movimiento: la política de la 052 solo le deja escribir dentro de
// una carpeta que se llama como su propio id. Esta accion no toca el archivo,
// solo apunta el cliente hacia él.
//
// El `.eq("owner_id", user.id)` no sobra por tener RLS detras: clientId llega
// del navegador, y comprobar a quién pertenece antes de escribir es la regla
// que este proyecto ya se saltó dos veces. Si el cliente no es suyo, la
// actualización no encuentra fila y no pasa nada.
export async function setClientProfilePicture(
  clientId: string,
  path: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
  if (!clientId) return { error: "Cliente inválido." };

  // Una ruta que no empiece por la carpeta del dueño se rechaza aquí también, y
  // no solo en Storage: sin esto, alguien podría apuntar a un cliente suyo
  // hacia la foto de un cliente ajeno — el bucket es público, así que bastaría
  // con saber la ruta. La política de Storage gobierna quién ESCRIBE archivos;
  // esta comprobación gobierna a cuál se puede APUNTAR.
  if (path && !path.startsWith(`${user.id}/`)) {
    return { error: "No pudimos guardar la foto." };
  }

  // La ruta que había antes, para poder borrar ese archivo después. Se lee con
  // el mismo filtro de dueño, así que si el cliente no es suyo no hay fila y no
  // se toca nada.
  const { data: actual } = await supabase
    .from("clients")
    .select("profile_picture_path")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!actual) return { error: "Cliente inválido." };

  const { error } = await supabase
    .from("clients")
    .update({ profile_picture_path: path })
    .eq("id", clientId)
    .eq("owner_id", user.id);

  if (error) return { error: `No pudimos guardar la foto: ${error.message}` };

  // El archivo viejo se borra de verdad, y después de actualizar la fila, no
  // antes: si el borrado falla queda un archivo huérfano ocupando espacio, que
  // es molesto; al revés quedaría un cliente apuntando a una foto que ya no
  // existe, que es un círculo roto en pantalla.
  //
  // Dos motivos para borrarlo y no solo desvincularlo. El espacio se paga y
  // cada foto nueva dejaba la anterior guardada para siempre. Y el bucket es
  // público: una foto "borrada" que sigue en su sitio sigue abierta a cualquiera
  // que conozca el enlace, que es lo contrario de lo que el dueño acaba de
  // pedir. El borrado va con la sesión del dueño, así que la política de la 052
  // lo limita a su propia carpeta.
  const anterior = actual.profile_picture_path as string | null;
  if (anterior && anterior !== path) {
    const { error: borrado } = await supabase.storage
      .from("client-profile-pictures")
      .remove([anterior]);
    // No se le devuelve al dueño: para él la acción salió bien —su cliente ya
    // tiene la foto que quería, o ninguna—. Un archivo que sobra es cosa
    // nuestra, no suya.
    if (borrado) console.error("[foto-cliente] no pudimos borrar la anterior:", borrado.message);
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null };
}
