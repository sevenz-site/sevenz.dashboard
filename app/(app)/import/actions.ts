"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeDocumentId } from "@/lib/format";
import { resolveMovementRateSnapshot, type MovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { trackServer } from "@/lib/mixpanel-server";
import { recordMovementRejection } from "@/lib/movement-rejection";
import type { LedgerCurrency, MovementType } from "@/lib/types";

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
  // Chosen by the owner per row in the review table, because one libreta can
  // mix currencies.
  //
  // null significa dos cosas distintas según el país, y por eso no se puede
  // tratar igual: en un negocio CO es la respuesta correcta — su libro no tiene
  // dimensión de moneda —, y en uno VE es un dato que falta.
  //
  // Esto ya NO se rellena solo. Hasta 2026-09-11, un null de un dueño VE se
  // convertía en USD por defecto: una apuesta sobre el dinero de alguien, hecha
  // donde nadie la veía. Ahora resolveMovementRateSnapshot rechaza, y la tanda
  // entera se detiene sin escribir ni una fila.
  currency: LedgerCurrency | null;
};

export type ConfirmImportState = { error: string | null; imported: number };

export async function confirmImport(rows: ImportRow[]): Promise<ConfirmImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", imported: 0 };
  if (rows.length === 0) return { error: "No hay movimientos para importar.", imported: 0 };

  // Resolved once per distinct currency in the batch, not once per row.
  //
  // getOwnerRateContext underneath makes three database round trips and can
  // trigger a BCV refresh, so calling it per row would multiply that by the
  // whole import. There are at most two distinct currencies (a VE owner's USD
  // and EUR) or one (a CO owner's null), so this is one or two calls either
  // way.
  //
  // This used to be a single call with a hardcoded null, which meant a VE
  // owner importing a libreta kept in euros got every row filed as USD —
  // their client's real debt, in the wrong ledger, with no currency shown
  // anywhere in the review screen to catch it.
  //
  // Y se resuelven TODAS antes de insertar la primera fila. Si alguna moneda de
  // la tanda no se puede resolver, la importación aborta aquí, con cero filas
  // escritas: media libreta importada es peor que ninguna, porque el dueño no
  // sabe por dónde iba y reimportar duplica lo que ya entró.
  const snapshots = new Map<string, MovementRateSnapshot>();
  for (const currency of new Set(rows.map((r) => r.currency ?? null))) {
    const resolucion = await resolveMovementRateSnapshot(supabase, user.id, currency);
    if (!resolucion.ok) {
      // rows.length y no 1: aquí se pierde la tanda entera, y ese es el número
      // que dice lo que costó. Sin él, un rechazo de import parece tan barato
      // como uno de un fiado suelto.
      await recordMovementRejection(supabase, {
        reason: resolucion.reason,
        source: "import",
        userId: user.id,
        userEmail: user.email,
        attemptedCurrency: currency,
        rowsAffected: rows.length,
      });
      return { error: resolucion.error, imported: 0 };
    }
    snapshots.set(currency ?? "COP", resolucion.snapshot);
  }

  // The import review table collects no per-client document country, so a
  // client created here inherits the owner's own — right for the vast
  // majority, and correctable afterward from "Editar cliente" for the
  // cross-border exceptions.
  const { data: ownerRow } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();
  const ownerCountry = (ownerRow?.country as string | undefined) ?? null;

  // client_id, when present, comes straight from the browser — verify each
  // one actually belongs to this owner before trusting it, rather than
  // relying only on the movements insert's RLS check to catch a mismatch.
  const providedClientIds = [...new Set(rows.map((r) => r.client_id).filter((id): id is string => Boolean(id)))];
  const ownedClientIds = new Set<string>();
  // Existing clients' current document_id, checked server-side rather than
  // trusting the review table's own needs_document_id flag — that flag is
  // just what decided whether to show/require the input client-side.
  const existingDocumentIds = new Map<string, string | null>();
  // A row can sit in the review table long enough for its client to be moved
  // to the Papelera in another tab. Confirming it then would write movements
  // onto a client no list shows and no total counts, which is the silent kind
  // of wrong — so the whole batch stops and names the client.
  const hiddenClientNames = new Map<string, string>();
  if (providedClientIds.length > 0) {
    const { data: ownedClients } = await supabase
      .from("clients")
      .select("id, name, document_id, trashed_at, deleted_at")
      .eq("owner_id", user.id)
      .in("id", providedClientIds);
    for (const c of ownedClients ?? []) {
      ownedClientIds.add(c.id as string);
      existingDocumentIds.set(c.id as string, c.document_id as string | null);
      if (c.trashed_at || c.deleted_at) hiddenClientNames.set(c.id as string, c.name as string);
    }
  }
  if (hiddenClientNames.size > 0) {
    const names = [...hiddenClientNames.values()].join(", ");
    return {
      error: `${names} está en la papelera. Restáuralo desde Papelera para continuar con esta importación.`,
      imported: 0,
    };
  }

  // Nothing stops the same person being registered twice under one owner —
  // catch it here before creating a brand-new client, same as the manual
  // "Registrar cliente nuevo" flow. Seeded from every client this owner
  // already has on file, then grown as new clients get created below so
  // two different rows in the SAME batch can't collide with each other
  // either. There's no per-row picker in this batch flow, so a hit just
  // blocks the whole import with a clear message instead of silently
  // duplicating.
  //
  // Hidden clients are included here on purpose (decision O3): the import must
  // match them rather than quietly create a second record, which would split
  // one person's history across two clients with no way for the owner to merge
  // them back.
  const { data: allOwnerClients } = await supabase
    .from("clients")
    .select("id, name, document_id, trashed_at, deleted_at")
    .eq("owner_id", user.id)
    .not("document_id", "is", null);
  const clientsByNormalizedDocumentId = new Map<string, { id: string; name: string; hidden: boolean }>();
  for (const c of allOwnerClients ?? []) {
    if (!c.document_id) continue;
    clientsByNormalizedDocumentId.set(normalizeDocumentId(c.document_id as string), {
      id: c.id as string,
      name: c.name as string,
      hidden: Boolean(c.trashed_at || c.deleted_at),
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
          error: duplicate.hidden
            ? `${duplicate.name} ya tiene esta cédula y está en la papelera. Restáuralo desde Papelera y vuelve a seleccionarlo en la tabla.`
            : `Ya existe un cliente con esta cédula: ${duplicate.name}. Selecciónalo en la tabla en vez de crear uno nuevo.`,
          imported,
        };
      }

      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({
          owner_id: user.id,
          name: row.client_name.trim(),
          document_id: documentId,
          document_country: ownerCountry,
        })
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
      clientsByNormalizedDocumentId.set(normalizedDocumentId, {
        id: clientId,
        name: row.client_name.trim(),
        hidden: false,
      });
    }

    // No needs_review here: the owner already saw and could fix every
    // flagged row in the import review screen before confirming, so
    // confirming the import *is* the review — defaults to false in the DB.
    const resolved = snapshots.get(row.currency ?? "COP")!;

    const { error: movementError } = await supabase.from("movements").insert({
      client_id: clientId,
      created_by: user.id,
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

  // The photo-import path had no analytics at all: an owner who works mainly
  // from their libreta could import dozens of movements and register as
  // completely inactive. One event per confirmed import rather than one per
  // row — the batch is the meaningful action, and per-row events would be a
  // burst of near-identical noise.
  trackServer(
    "Import Confirmed",
    user.id,
    { movements_imported: imported, clients_created: clientIdByName.size },
    user.email,
  );

  revalidatePath("/dashboard");
  return { error: null, imported };
}
