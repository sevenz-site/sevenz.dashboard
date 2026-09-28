import type { createClient } from "@/lib/supabase/server";
import type { OwnerPlan } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImportUsage = {
  plan: OwnerPlan;
  used: number;
  limit: number | null;
  remaining: number | null;
};

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Shared by the /api/extract route (authoritative gate, prevents bypass) and
// the import page/provider (drives the progress bar). Only 'done' rows count
// — a failed OCR read shouldn't burn the owner's monthly quota.
export async function getImportUsageForOwner(
  supabase: SupabaseServerClient,
  ownerId: string,
): Promise<ImportUsage> {
  const [{ data: owner }, { count }] = await Promise.all([
    supabase.from("owners").select("plan").eq("id", ownerId).single(),
    supabase
      .from("import_notifications")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("status", "done")
      .gte("created_at", startOfCurrentMonthIso()),
  ]);

  const plan: OwnerPlan = owner?.plan === "pro" ? "pro" : "free";
  const used = count ?? 0;

  // SIN LÍMITE EN NINGÚN PLAN, desde el 2026-09-28. El plan Free tenía 5 fotos
  // al mes; ya no tiene ninguna.
  //
  // `limit: null` es lo que este módulo siempre ha usado para decir "no hay
  // tope" —era lo que devolvía Pro—, así que las guardas de la ruta y de las
  // dos pantallas, que ya preguntan por `limit !== null`, se apagan solas. No
  // hay ningún sitio donde el tope siga vivo a medias.
  //
  // `used` se sigue contando: alimenta la pantalla y las métricas, y el día que
  // vuelva a haber un tope hará falta. Lo que se quitó es la puerta, no el
  // contador.
  return { plan, used, limit: null, remaining: null };
}
