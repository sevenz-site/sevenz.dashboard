import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Makes sure today's inventory notices exist for the signed-in owner (CT-162,
// migration 183). The trigger on `products` raises a notice the moment a sale
// empties the shelf; THIS is what raises tomorrow's for a product still low
// that nobody touched — the owner's decision was «cada día mientras siga
// bajo», and he only sees notices with the app open, so «each day the app is
// opened» is «each day» for him.
//
// Called on a full page load (the layout) and when the bell opens. NOT from
// `getUnreadNotificationCount`, which runs on a timer in every open tab: that
// would be a write every few seconds per tab to produce at most one row a day.
//
// A failure only logs. A missing notice is a lesser harm than a screen that
// does not load.
export async function refreshStockAlerts(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("refresh_stock_alerts");
  if (error) console.error("refreshStockAlerts: refresh_stock_alerts failed", error);
}
