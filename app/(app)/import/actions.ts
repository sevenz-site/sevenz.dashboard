"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import type { MovementType } from "@/lib/types";

export type ImportRow = {
  client_id: string | null;
  client_name: string;
  type: MovementType;
  amount: number;
  description: string | null;
};

export type ConfirmImportState = { error: string | null; imported: number };

export async function confirmImport(rows: ImportRow[]): Promise<ConfirmImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", imported: 0 };
  if (rows.length === 0) return { error: "No hay movimientos para importar.", imported: 0 };

  // Same resolution every imported row gets — a photo import never collects
  // a per-row currency, so this is either null (CO owner) or the owner's
  // current ledger currency (VE owner), resolved once for the whole batch.
  const resolved = await resolveMovementRateSnapshot(supabase, user.id, null);

  // client_id, when present, comes straight from the browser — verify each
  // one actually belongs to this owner before trusting it, rather than
  // relying only on the movements insert's RLS check to catch a mismatch.
  const providedClientIds = [...new Set(rows.map((r) => r.client_id).filter((id): id is string => Boolean(id)))];
  let ownedClientIds = new Set<string>();
  if (providedClientIds.length > 0) {
    const { data: ownedClients } = await supabase
      .from("clients")
      .select("id")
      .eq("owner_id", user.id)
      .in("id", providedClientIds);
    ownedClientIds = new Set((ownedClients ?? []).map((c) => c.id as string));
  }

  const clientIdByName = new Map<string, string>();
  let imported = 0;

  for (const row of rows) {
    const cacheKey = row.client_name.trim().toLowerCase();
    let clientId: string;

    if (row.client_id) {
      if (!ownedClientIds.has(row.client_id)) {
        return { error: `Cliente inválido para "${row.client_name}".`, imported };
      }
      clientId = row.client_id;
    } else if (clientIdByName.has(cacheKey)) {
      clientId = clientIdByName.get(cacheKey)!;
    } else {
      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({ owner_id: user.id, name: row.client_name.trim() })
        .select("id")
        .single();

      if (clientError || !newClient) {
        return {
          error: `No pudimos crear el cliente "${row.client_name}": ${clientError?.message ?? "error desconocido"}`,
          imported,
        };
      }
      clientId = newClient.id as string;
      clientIdByName.set(cacheKey, clientId);
    }

    // No needs_review here: the owner already saw and could fix every
    // flagged row in the import review screen before confirming, so
    // confirming the import *is* the review — defaults to false in the DB.
    const { error: movementError } = await supabase.from("movements").insert({
      client_id: clientId,
      type: row.type,
      amount: row.amount,
      currency: resolved.currency,
      description: row.description,
      source: "photo_import",
      rate_mode_used: resolved.rateModeUsed,
      exchange_rate_used: resolved.exchangeRateUsed,
      official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
      entry_currency: resolved.entryCurrency,
      entry_amount: resolved.entryCurrency ? row.amount : null,
      rate_usd_at_time: resolved.rateUsdAtTime,
      rate_eur_at_time: resolved.rateEurAtTime,
    });

    if (movementError) {
      return {
        error: `No pudimos guardar el movimiento de "${row.client_name}": ${movementError.message}`,
        imported,
      };
    }

    imported += 1;
  }

  revalidatePath("/dashboard");
  return { error: null, imported };
}
