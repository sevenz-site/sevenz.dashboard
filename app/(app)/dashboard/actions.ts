"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";

export type MovementFormState = { error: string | null; clientId: string | null };

type ParsedMovement =
  | { error: string }
  | {
      error: null;
      type: "charge" | "payment";
      amount: number;
      description: string | null;
      photoPath: string | null;
      plazoDias: number | null;
    };

const ALLOWED_PLAZO_DIAS = [7, 15, 30, 45];

function parseMovementFields(formData: FormData): ParsedMovement {
  const type = String(formData.get("type") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const photoPath = String(formData.get("photo_path") ?? "").trim();
  const plazoRaw = String(formData.get("plazo_dias") ?? "");

  if (type !== "charge" && type !== "payment") {
    return { error: "Selecciona el tipo de movimiento." };
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Ingresa un monto válido." };
  }

  // A payment has no payment term. A charge's plazo is only ever what the
  // form actually submitted — "sin_especificar" (or missing) means null.
  let plazoDias: number | null = null;
  if (type === "charge" && plazoRaw && plazoRaw !== "sin_especificar") {
    const parsed = Number(plazoRaw);
    if (!ALLOWED_PLAZO_DIAS.includes(parsed)) {
      return { error: "Plazo de pago inválido." };
    }
    plazoDias = parsed;
  }

  return {
    error: null,
    type,
    amount,
    description: description || null,
    photoPath: photoPath || null,
    plazoDias,
  };
}

// Creates a brand-new client together with their first movement.
export async function createClientWithMovement(
  _prevState: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", clientId: null };

  const name = String(formData.get("new_client_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!name) {
    return { error: "Escribe el nombre del cliente.", clientId: null };
  }

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, amount, description, photoPath, plazoDias } = fields;

  // A brand-new client has no prior debt, so there's nothing to pay off yet.
  if (type === "payment") {
    return { error: "Un cliente nuevo no puede empezar con un abono — todavía no debe nada.", clientId: null };
  }

  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      owner_id: user.id,
      name,
      whatsapp: whatsapp || null,
      address: address || null,
      document_id: documentId || null,
    })
    .select("id")
    .single();

  if (clientError || !newClient) {
    return {
      error: `No pudimos crear el cliente: ${clientError?.message ?? "error desconocido"}`,
      clientId: null,
    };
  }

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: newClient.id,
    type,
    amount,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
  });

  if (movementError) {
    return { error: `No pudimos guardar el movimiento: ${movementError.message}`, clientId: null };
  }

  revalidatePath("/dashboard");
  return { error: null, clientId: newClient.id };
}

// Adds a movement to a client that already exists (from the client detail page).
export async function addMovement(
  _prevState: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", clientId: null };

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { error: "Cliente inválido.", clientId: null };

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, amount, description, photoPath, plazoDias } = fields;

  // A payment can never exceed what the client currently owes — otherwise
  // the balance goes negative ("a favor"), which the product no longer
  // allows a payment to cause.
  if (type === "payment") {
    const { data: latest } = await supabase
      .from("movements")
      .select("running_balance")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentDebt = Number(latest?.running_balance ?? 0);
    if (currentDebt <= 0) {
      return { error: "Este cliente no debe nada — no se puede registrar un abono.", clientId: null };
    }
    if (amount > currentDebt) {
      return {
        error: `El abono no puede ser mayor a lo que debe (${formatCurrency(currentDebt)}).`,
        clientId: null,
      };
    }
  }

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: clientId,
    type,
    amount,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
  });

  if (movementError) {
    return { error: `No pudimos guardar el movimiento: ${movementError.message}`, clientId: null };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${clientId}`);
  return { error: null, clientId };
}

export async function getOrCreateShareLink(clientId: string): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("share_links")
    .select("token")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing) return { token: existing.token };

  const { data: created, error } = await supabase
    .from("share_links")
    .insert({ client_id: clientId })
    .select("token")
    .single();

  if (error || !created) return { error: "No pudimos generar el link." };

  return { token: created.token };
}

// Soft-deletes a movement the owner registered by mistake. The row stays in
// place (deleted_at set) so it can be restored later from a notification;
// every movement after it gets its running_balance rewritten to match.
export async function deleteMovement(movementId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id")
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos ese movimiento." };
  }

  const { error: deleteError } = await supabase
    .from("movements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", movementId);

  if (deleteError) {
    return { error: `No pudimos eliminar el movimiento: ${deleteError.message}` };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: `No pudimos recalcular el saldo: ${recalcError.message}` };
  }

  const { error: notifyError } = await supabase.from("movement_deletions").insert({
    movement_id: movementId,
    owner_id: user.id,
    client_id: movement.client_id,
  });
  if (notifyError) {
    console.error("deleteMovement: failed to record notification", notifyError);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${movement.client_id}`);
  return { error: null };
}

// Restores a movement previously deleted via deleteMovement, recalculating
// balances the same way. Triggered from the "movimiento eliminado" notification.
export async function restoreMovement(movementId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id")
    .eq("id", movementId)
    .not("deleted_at", "is", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos ese movimiento eliminado." };
  }

  const { error: restoreError } = await supabase
    .from("movements")
    .update({ deleted_at: null })
    .eq("id", movementId);

  if (restoreError) {
    return { error: `No pudimos restaurar el movimiento: ${restoreError.message}` };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: `No pudimos recalcular el saldo: ${recalcError.message}` };
  }

  await supabase
    .from("movement_deletions")
    .update({ restored_at: new Date().toISOString() })
    .eq("movement_id", movementId)
    .is("restored_at", null);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${movement.client_id}`);
  return { error: null };
}
