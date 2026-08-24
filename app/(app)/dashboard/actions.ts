"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { toUsd, usdToDisplay, type MovementCurrency } from "@/lib/exchange-rate/convert";

export type MovementFormState = { error: string | null; clientId: string | null };

type ParsedMovement =
  | { error: string }
  | {
      error: null;
      type: "charge" | "payment";
      amount: number;
      currency: MovementCurrency;
      description: string | null;
      photoPath: string | null;
      plazoDias: number | null;
    };

const ALLOWED_PLAZO_DIAS = [7, 15, 30, 45];
const ALLOWED_CURRENCIES: MovementCurrency[] = ["VES", "USD", "EUR"];

function parseMovementFields(formData: FormData): ParsedMovement {
  const type = String(formData.get("type") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const currencyRaw = String(formData.get("movement_currency") ?? "VES");
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
  const currency = ALLOWED_CURRENCIES.includes(currencyRaw as MovementCurrency)
    ? (currencyRaw as MovementCurrency)
    : "VES";

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
    currency,
    description: description || null,
    photoPath: photoPath || null,
    plazoDias,
  };
}

// Converts the entered amount into USD — the canonical unit of a VE owner's
// dollar-indexed ledger — and returns the audit snapshot. Returns the amount
// completely untouched (and every snapshot field null) for a 'CO' owner or
// a 'VE' owner with no rate fetched yet, whose ledger stays plain COP.
async function resolveMovementAmount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  rawAmount: number,
  currency: MovementCurrency,
) {
  const rateContext = await getOwnerRateContext(supabase, ownerId);
  if (!rateContext) {
    return {
      amount: rawAmount,
      rateModeUsed: null,
      exchangeRateUsed: null,
      officialBcvRateAtTime: null,
      entryCurrency: null,
      entryAmount: null,
      rateUsdAtTime: null,
      rateEurAtTime: null,
      ledger: null,
    };
  }

  const amount = toUsd(rawAmount, currency, rateContext.effectiveRate);
  const officialForCurrency =
    currency === "USD"
      ? rateContext.officialRate.usd
      : currency === "EUR"
        ? rateContext.officialRate.eur
        : null;
  const effectiveForCurrency =
    currency === "USD"
      ? rateContext.effectiveRate.usd
      : currency === "EUR"
        ? rateContext.effectiveRate.eur
        : null;

  return {
    amount,
    rateModeUsed: rateContext.rateMode,
    exchangeRateUsed: effectiveForCurrency,
    officialBcvRateAtTime: officialForCurrency,
    // Stored as typed, so the movement detail can show a verifiable
    // conversion instead of a derived-after-the-fact figure.
    entryCurrency: currency,
    entryAmount: rawAmount,
    // Both rates, not just the entered currency's — a balance shown in USD
    // needs that day's USD rate even when the movement was entered in EUR.
    rateUsdAtTime: rateContext.effectiveRate.usd,
    rateEurAtTime: rateContext.effectiveRate.eur,
    ledger: {
      displayCurrency: rateContext.displayCurrency,
      rate: rateContext.effectiveRate,
    },
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
  const { type, amount, currency, description, photoPath, plazoDias } = fields;

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

  const resolved = await resolveMovementAmount(supabase, user.id, amount, currency);

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: newClient.id,
    type,
    amount: resolved.amount,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: resolved.entryCurrency,
    entry_amount: resolved.entryAmount,
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
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
  const { type, amount, currency, description, photoPath, plazoDias } = fields;

  // Converted to Bs (or left untouched for a 'CO' owner) before the debt
  // check below — running_balance is always in the same unit as amount,
  // so comparing a raw USD/EUR entry against it directly would be wrong.
  const resolved = await resolveMovementAmount(supabase, user.id, amount, currency);

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
    if (resolved.amount > currentDebt) {
      // currentDebt is in the ledger's own unit — USD for a VE owner, COP
      // otherwise — so it has to be formatted with the matching formatter.
      const formattedDebt = resolved.ledger
        ? formatDisplayCurrency(
            usdToDisplay(currentDebt, resolved.ledger.displayCurrency, resolved.ledger.rate),
            resolved.ledger.displayCurrency,
          )
        : formatCurrency(currentDebt);
      return {
        error: `El abono no puede ser mayor a lo que debe (${formattedDebt}).`,
        clientId: null,
      };
    }
  }

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: clientId,
    type,
    amount: resolved.amount,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: resolved.entryCurrency,
    entry_amount: resolved.entryAmount,
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
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
