"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MovementType } from "@/lib/types";

export type ImportRow = {
  client_id: string | null;
  client_name: string;
  type: MovementType;
  amount: number;
  description: string | null;
  needs_review: boolean;
};

export type ConfirmImportState = { error: string | null; imported: number };

export async function confirmImport(rows: ImportRow[]): Promise<ConfirmImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", imported: 0 };
  if (rows.length === 0) return { error: "No hay movimientos para importar.", imported: 0 };

  const clientIdByName = new Map<string, string>();
  let imported = 0;

  for (const row of rows) {
    const cacheKey = row.client_name.trim().toLowerCase();
    const resolvedId: string | null = row.client_id ?? clientIdByName.get(cacheKey) ?? null;
    let clientId: string;

    if (resolvedId) {
      clientId = resolvedId;
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

    const { error: movementError } = await supabase.from("movements").insert({
      client_id: clientId,
      type: row.type,
      amount: row.amount,
      description: row.description,
      source: "photo_import",
      needs_review: row.needs_review,
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
