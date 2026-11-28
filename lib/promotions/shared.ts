import type { SupabaseClient } from "@supabase/supabase-js";
import { promotionPercentFor, type SharedPromotion } from "./pricing";

// THE ACTIVE PROMOTION FOR A PUBLIC PAGE, read with `get_shared_promotion` (migration 228).
// Null when none is on, when 228 has not run, or on any error: a public page then shows its
// list prices, never a broken page. Errors are masked (CLAUDE.md, unauthenticated reads): the
// detail goes to the server log only.
export async function readSharedPromotion(
  supabase: SupabaseClient,
  catalogToken: string,
  where: string,
): Promise<SharedPromotion | null> {
  try {
    const { data, error } = await supabase.rpc("get_shared_promotion", { p_token: catalogToken });
    if (error) {
      console.error(`[${where}] promotion rpc:`, error.message);
      return null;
    }
    return (data as SharedPromotion | null) ?? null;
  } catch (error) {
    console.error(`[${where}] promotion threw:`, error instanceof Error ? error.message : error);
    return null;
  }
}

// Each product with the % it gets, for the product strips (`CatalogStrip`). Added on the
// server so the strip, a client component, only draws. Found in the browser QA of
// 2026-11-28: the order receipt's «Otros productos» showed $65,00 for a product the catalogue
// had just sold at $52,00.
export function withPromoPercent<T extends { id: string; tier: "retail" | "wholesale" }>(
  products: T[],
  promo: SharedPromotion | null,
): (T & { promo_percent: number | null })[] {
  return products.map((p) => ({ ...p, promo_percent: promotionPercentFor(promo, p.id, p.tier) }));
}
