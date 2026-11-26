import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/products/availability";

export type BarcodeSettings = { enabled: boolean; lowStockThreshold: number };

// WHETHER THIS BUSINESS WORKS WITH BARCODES (CT-182, `owners.barcodes_enabled`, 219), and
// the low-stock threshold the scanner's product card needs for its `StockBadge`.
//
// ITS OWN READ, NOT A COLUMN ADDED TO THE SHELL'S `owners` SELECT. That select feeds the
// business name, the plan and the country of every screen: if it named a column that does
// not exist yet -- the code deployed before migration 219, or dev before it runs -- the
// whole shell would lose its owner row. Here a failed read is just «off», which is what
// the business had before this feature existed.
export const getBarcodeSettings = cache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (supabase: SupabaseClient<any, any, any>, ownerId: string): Promise<BarcodeSettings> => {
    const off = { enabled: false, lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD };
    try {
      const { data, error } = await supabase
        .from("owners")
        .select("barcodes_enabled, low_stock_threshold")
        .eq("id", ownerId)
        .maybeSingle();
      if (error || !data) return off;
      const row = data as { barcodes_enabled?: boolean; low_stock_threshold?: number | null };
      return {
        enabled: row.barcodes_enabled === true,
        lowStockThreshold: Number(row.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD),
      };
    } catch {
      return off;
    }
  },
);
