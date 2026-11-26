import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantDay } from "@/lib/reports/assistant/day";

// ═══════════════════════════════════════════════════════════════════════
// THE RED DOT ON «REPORTES»: is there an assistant analysis the owner has not read?
//
// Owner's request of 2026-11-25: a red dot like the notifications one, shown when
// the Reportes assistant has a new analysis and gone once he reads it.
//
// NO «READ» COLUMN, AND THAT IS NOT AN OVERSIGHT. The assistant does not write its
// note on its own: `/api/reportes/asistente` writes it the moment Reportes opens and
// asks for it. So «a note for today exists» and «today's note was read» are the same
// fact, and a `seen_at` column would only be a second copy of it that can drift.
// Asked on 2026-11-25 with the alternative on the table (a nightly job writing every
// business's note in advance, one AI call each even if nobody opens it), the owner
// chose «Cada día, hasta abrir».
//
// If generation ever moves to a scheduled job, this stops being true: a note would
// exist before anyone read it, and the dot would never show. That is the day this
// needs a real `seen_at`.
//
// NO DOT FOR A BUSINESS WITH NOTHING IN IT. Its note says there is nothing to
// report, and a daily «new report» about nothing teaches the owner to ignore the dot.
// «Nothing in it» is the assistant's own test (`negocioSinNada` in
// `lib/reports/facturacion.ts`): no clients at all, since even a counter sale
// creates its «Mostrador».
//
// FAILS CLOSED: if either read errors, no dot. A dot that lies costs more than one
// that is late, and the next page load asks again.
// ═══════════════════════════════════════════════════════════════════════
export async function hasUnreadAssistantNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ownerId: string,
): Promise<boolean> {
  const [note, clients] = await Promise.all([
    // `.eq("owner_id")` on top of RLS, per CLAUDE.md's ownership rule.
    supabase
      .from("report_assistant_notes")
      .select("day")
      .eq("owner_id", ownerId)
      .eq("day", assistantDay())
      .limit(1),
    supabase.from("clients").select("id").eq("owner_id", ownerId).limit(1),
  ]);
  if (note.error || clients.error) {
    console.error("[hasUnreadAssistantNote]", note.error?.message ?? clients.error?.message);
    return false;
  }
  return (note.data ?? []).length === 0 && (clients.data ?? []).length > 0;
}
