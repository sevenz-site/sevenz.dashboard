import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/products/availability";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// READING THE OWNER'S «avísame cuando queden N o menos».
//
// It sits in its own file, apart from `availability.ts`, so that the rule
// stays importable from a client component: this one pulls in the server
// Supabase types and `availability.ts` must not.
//
// FALLING BACK TO THE DEFAULT RATHER THAN THROWING is deliberate. Every caller
// is a screen whose job is something else — a product page, an order step —
// and none of them should fail to render because one scalar did not load. The
// failure mode that buys is the mild one: a chip that is green when it should
// be amber, which is what every one of these screens did until today anyway.
export async function loadLowStockThreshold(
  supabase: SupabaseServerClient,
  ownerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("owners")
    .select("low_stock_threshold")
    .eq("id", ownerId)
    .single();
  if (error) {
    console.error("[loadLowStockThreshold]", error.message);
    return DEFAULT_LOW_STOCK_THRESHOLD;
  }
  return Number(data?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
}
