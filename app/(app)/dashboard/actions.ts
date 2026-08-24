"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { DEFAULT_LEDGER_CURRENCY, type LedgerCurrency } from "@/lib/types";

export type MovementFormState = { error: string | null; clientId: string | null };

type ParsedMovement =
  | { error: string }
  | {
      error: null;
      type: "charge" | "payment";
      amount: number;
      // Absent means the owner is 'CO' (plain COP, no currency select shown
      // at all) — validated against the owner's actual country below, not
      // trusted from the form alone.
      currency: LedgerCurrency | null;
      description: string | null;
      photoPath: string | null;
      plazoDias: number | null;
    };

const ALLOWED_PLAZO_DIAS = [7, 15, 30, 45];
const ALLOWED_CURRENCIES: LedgerCurrency[] = ["USD", "EUR"];

function parseMovementFields(formData: FormData): ParsedMovement {
  const type = String(formData.get("type") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const currencyRaw = formData.get("movement_currency");
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
  const currency = ALLOWED_CURRENCIES.includes(currencyRaw as LedgerCurrency)
    ? (currencyRaw as LedgerCurrency)
    : null;

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

type MovementLedger = { currency: LedgerCurrency | null; rate: { usd: number; eur: number } | null };

// Resolves the rate snapshot for a movement. No conversion happens here —
// USD/EUR amounts are stored exactly as typed, since $50 and €20 are two
// independent debts, not one debt seen two ways. A 'CO' owner gets every
// snapshot field null and a null currency, same as today's plain COP
// behavior — that's the only case where a null currency is correct.
async function resolveMovementRateSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  currency: LedgerCurrency | null,
) {
  const rateContext = await getOwnerRateContext(supabase, ownerId);
  if (!rateContext) {
    return {
      currency: null,
      rateModeUsed: null,
      exchangeRateUsed: null,
      officialBcvRateAtTime: null,
      entryCurrency: null,
      entryAmount: null,
      rateUsdAtTime: null,
      rateEurAtTime: null,
      ledger: null as MovementLedger | null,
    };
  }

  // getOwnerRateContext re-reads the owner fresh from the database on every
  // request, so a non-null rateContext here means this owner is VE *right
  // now* — regardless of what the submitted form believed. A page rendered
  // before the owner's country changed won't have shown the currency field
  // at all, so `currency` arrives null even though this is really a VE
  // movement; falling through to the null-currency branch above would
  // silently save it into the wrong (COP) ledger. Default to USD instead of
  // trusting the client's stale assumption.
  const resolvedCurrency = currency ?? DEFAULT_LEDGER_CURRENCY;

  const officialForCurrency =
    resolvedCurrency === "USD" ? rateContext.officialRate.usd : rateContext.officialRate.eur;
  const effectiveForCurrency =
    resolvedCurrency === "USD" ? rateContext.effectiveRate.usd : rateContext.effectiveRate.eur;

  return {
    currency: resolvedCurrency,
    rateModeUsed: rateContext.rateMode,
    exchangeRateUsed: effectiveForCurrency,
    officialBcvRateAtTime: officialForCurrency,
    // entry_currency/entry_amount mirror currency/amount now that nothing
    // gets converted at write time — kept so the movement detail's existing
    // "what was typed" rows keep working unchanged.
    entryCurrency: resolvedCurrency,
    rateUsdAtTime: rateContext.effectiveRate.usd,
    rateEurAtTime: rateContext.effectiveRate.eur,
    ledger: { currency: resolvedCurrency, rate: rateContext.effectiveRate } as MovementLedger,
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

  const resolved = await resolveMovementRateSnapshot(supabase, user.id, currency);

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: newClient.id,
    type,
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: resolved.entryCurrency,
    entry_amount: resolved.entryCurrency ? amount : null,
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

  const resolved = await resolveMovementRateSnapshot(supabase, user.id, currency);

  // A payment can never exceed what the client currently owes in that SAME
  // currency — a dollar payment can't pay off a euro debt, since they're
  // independent ledgers. is("currency", ...) / eq("currency", ...) below
  // scopes the lookup to the right one (null = the CO owner's plain ledger).
  if (type === "payment") {
    let balanceQuery = supabase
      .from("movements")
      .select("running_balance")
      .eq("client_id", clientId)
      .is("deleted_at", null);
    balanceQuery = resolved.currency
      ? balanceQuery.eq("currency", resolved.currency)
      : balanceQuery.is("currency", null);

    const { data: latest } = await balanceQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentDebt = Number(latest?.running_balance ?? 0);
    if (currentDebt <= 0) {
      return { error: "Este cliente no debe nada en esta moneda — no se puede registrar un abono.", clientId: null };
    }
    if (amount > currentDebt) {
      const formattedDebt = resolved.currency
        ? formatDisplayCurrency(currentDebt, resolved.currency)
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
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: resolved.entryCurrency,
    entry_amount: resolved.entryCurrency ? amount : null,
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
