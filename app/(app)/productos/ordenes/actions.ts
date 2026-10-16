"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// THE ONE WRITE IN D's READING HALF, and it is here for a reason worth
// stating: without it the counter can only ever go up.
//
// The owner decided on 2026-10-16 that the bell counts orders that still need
// attention (CT-71). A screen that lists them and offers no way to say "done
// with this one" leaves a red number that never drops, and a badge that is
// always on is a badge nobody reads -- the same failure the ledger parity rule
// warns about, in a different place.
//
// What it does NOT do, deliberately: it does not edit the customer's name,
// document or phone (that is CT-69's decision about the consent), and it does
// not register the order as a fiado or a sale (that is CT-70, and the plan of
// 2026-10-16 puts it after the product selector exists).

export type OrderActionResult = { error: string | null };

export async function markOrderAttended(orderId: string): Promise<OrderActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // `.eq("owner_id", user.id)` EXPLICITLY, not RLS alone. `orderId` arrives
  // from the browser, and CLAUDE.md's rule exists because two functions once
  // relied on the policy and would have had nothing left if a migration ever
  // loosened it. The policy is the backstop; this is the lock.
  const { error, count } = await supabase
    .from("catalog_orders")
    .update({ status: "seen", seen_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", orderId)
    .eq("owner_id", user.id)
    // ONLY FROM `new`. An order already registered or discarded must not be
    // dragged back to "seen" by a second tap -- `status` is what CT-70's
    // button will set, and this one must never undo it.
    .eq("status", "new");

  if (error) {
    console.error("[orders] markOrderAttended:", error.message);
    return { error: "No pudimos marcar el pedido. Intenta de nuevo." };
  }

  // Zero rows is not an error the shopkeeper needs to see: it means the order
  // was already attended, which is where they wanted to get to anyway.
  if (count === 0) {
    console.warn("[orders] markOrderAttended: nada que marcar", orderId);
  }

  revalidatePath("/productos/ordenes");
  revalidatePath(`/productos/ordenes/${orderId}`);
  // The bell and the Catálogo link both carry the count, so both go stale.
  revalidatePath("/productos");
  revalidatePath("/notificaciones");
  return { error: null };
}
