"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeDocumentId } from "@/lib/format";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import type { MovementType } from "@/lib/types";

export type ImportRow = {
  client_id: string | null;
  client_name: string;
  type: MovementType;
  amount: number;
  description: string | null;
  // Required unless client_id already points to a client who has one on
  // file — see the "needs_document_id" review-table logic that decides
  // when the owner actually had to type this in.
  document_id: string | null;
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
  const ownedClientIds = new Set<string>();
  // Existing clients' current document_id, checked server-side rather than
  // trusting the review table's own needs_document_id flag — that flag is
  // just what decided whether to show/require the input client-side.
  const existingDocumentIds = new Map<string, string | null>();
  if (providedClientIds.length > 0) {
    const { data: ownedClients } = await supabase
      .from("clients")
      .select("id, document_id")
      .eq("owner_id", user.id)
      .in("id", providedClientIds);
    for (const c of ownedClients ?? []) {
      ownedClientIds.add(c.id as string);
      existingDocumentIds.set(c.id as string, c.document_id as string | null);
    }
  }

  // Nothing stops the same person being registered twice under one owner —
  // catch it here before creating a brand-new client, same as the manual
  // "Registrar cliente nuevo" flow. Seeded from every client this owner
  // already has on file, then grown as new clients get created below so
  // two different rows in the SAME batch can't collide with each other
  // either. There's no per-row picker in this batch flow, so a hit just
  // blocks the whole import with a clear message instead of silently
  // duplicating.
  const { data: allOwnerClients } = await supabase
    .from("clients")
    .select("id, name, document_id")
    .eq("owner_id", user.id)
    .not("document_id", "is", null);
  const clientsByNormalizedDocumentId = new Map<string, { id: string; name: string }>();
  for (const c of allOwnerClients ?? []) {
    if (!c.document_id) continue;
    clientsByNormalizedDocumentId.set(normalizeDocumentId(c.document_id as string), {
      id: c.id as string,
      name: c.name as string,
    });
  }

  const clientIdByName = new Map<string, string>();
  let imported = 0;

  for (const row of rows) {
    const cacheKey = row.client_name.trim().toLowerCase();
    let clientId: string;

    const documentId = row.document_id?.trim() || null;

    if (row.client_id) {
      if (!ownedClientIds.has(row.client_id)) {
        return { error: `Cliente inválido para "${row.client_name}".`, imported };
      }
      clientId = row.client_id;
      // Only require/persist a document_id here if this client didn't
      // already have one — never overwrite an existing value.
      if (!existingDocumentIds.get(clientId)) {
        if (!documentId) {
          return { error: `Falta la cédula/documento de "${row.client_name}".`, imported };
        }
        const { error: updateError } = await supabase
          .from("clients")
          .update({ document_id: documentId })
          .eq("id", clientId);
        if (updateError) {
          return {
            error: `No pudimos guardar la cédula de "${row.client_name}": ${updateError.message}`,
            imported,
          };
        }
        existingDocumentIds.set(clientId, documentId);
      }
    } else if (clientIdByName.has(cacheKey)) {
      clientId = clientIdByName.get(cacheKey)!;
    } else {
      if (!documentId) {
        return { error: `Falta la cédula/documento de "${row.client_name}".`, imported };
      }

      const normalizedDocumentId = normalizeDocumentId(documentId);
      const duplicate = clientsByNormalizedDocumentId.get(normalizedDocumentId);
      if (duplicate) {
        return {
          error: `Ya existe un cliente con esta cédula: ${duplicate.name}. Selecciónalo en la tabla en vez de crear uno nuevo.`,
          imported,
        };
      }

      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({ owner_id: user.id, name: row.client_name.trim(), document_id: documentId })
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
      clientsByNormalizedDocumentId.set(normalizedDocumentId, { id: clientId, name: row.client_name.trim() });
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
