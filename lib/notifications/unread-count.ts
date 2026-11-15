import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BADGE_MAX } from "@/lib/types";

// The bell's unread count for one owner, given a client that already carries
// that owner's session. Moved out of app/(app)/actions.ts on 2026-11-15 so the
// layout can pass the user it already validated instead of asking Supabase
// Auth a second time (phase 2 of ../docs/RENDIMIENTO-PLAN.md).
//
// NOT A SERVER ACTION, ON PURPOSE. Every export of a "use server" file is an
// endpoint the browser can call with any arguments, so a version taking
// `ownerId` there would let anyone ask for another business's count. The
// action `getUnreadNotificationCount` (the timer in every open tab) still
// resolves the user itself and then delegates here.
export async function countUnreadNotifications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ownerId: string,
): Promise<number> {
  // The badge renders "9+" above nine, so nothing above ten is ever read —
  // and an exact count is the most expensive way to ask, because Postgres has
  // to walk (and RLS-check) every unread row just to reach a total nobody
  // sees. Fetching at most CAP ids per table answers the same question and
  // stops as soon as it has enough. This runs on a timer in every open tab,
  // so it's the query that scales with how many owners have the app open
  // rather than with what they're doing.
  const CAP = BADGE_MAX + 1;
  const [
    { data: opens, error: openError },
    { data: imports, error: importError },
    { data: deletions, error: deletionError },
    { data: hides, error: hideError },
    { data: productHides, error: productHideError },
    { data: unattendedOrders, error: ordersCountError },
    { data: unreadStockAlerts, error: stockAlertsCountError },
  ] = await Promise.all([
    supabase.from("link_opens").select("id").is("read_at", null).limit(CAP),
    supabase
      .from("import_notifications")
      .select("id")
      .eq("owner_id", ownerId)
      .is("read_at", null)
      .limit(CAP),
    supabase
      .from("movement_deletions")
      .select("id")
      .eq("owner_id", ownerId)
      .is("read_at", null)
      .limit(CAP),
    supabase.from("client_hides").select("id").eq("owner_id", ownerId).is("read_at", null).limit(CAP),
    supabase.from("product_hides").select("id").eq("owner_id", ownerId).is("read_at", null).limit(CAP),
    // ORDERS COUNT BY `status`, NOT BY `read_at`, and that is the whole point
    // of the owner's decision on 2026-10-16 (CT-71). Every other row above
    // leaves this count when somebody opens the bell; an order leaves it when
    // somebody ATTENDS it. Counting them the same way would show zero with
    // orders still waiting, which is the one number this badge must never
    // show.
    supabase
      .from("catalog_orders")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("status", "new")
      .limit(CAP),
    supabase.from("stock_alerts").select("id").eq("owner_id", ownerId).is("read_at", null).limit(CAP),
  ]);

  if (openError) console.error("getUnreadNotificationCount: link_opens query failed", openError);
  if (importError) console.error("getUnreadNotificationCount: import_notifications query failed", importError);
  if (deletionError) console.error("getUnreadNotificationCount: movement_deletions query failed", deletionError);
  if (hideError) console.error("getUnreadNotificationCount: client_hides query failed", hideError);
  if (productHideError)
    console.error("getUnreadNotificationCount: product_hides query failed", productHideError);
  if (ordersCountError)
    console.error("getUnreadNotificationCount: catalog_orders query failed", ordersCountError);
  if (stockAlertsCountError)
    console.error("getUnreadNotificationCount: stock_alerts query failed", stockAlertsCountError);

  return (
    (opens?.length ?? 0) +
    (imports?.length ?? 0) +
    (deletions?.length ?? 0) +
    (hides?.length ?? 0) +
    (productHides?.length ?? 0) +
    (unattendedOrders?.length ?? 0) +
    (unreadStockAlerts?.length ?? 0)
  );
}
