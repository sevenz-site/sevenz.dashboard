import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// WHETHER THIS BUSINESS WORKS WITH BARCODES (CT-182, `owners.barcodes_enabled`, 219).
//
// ITS OWN READ, NOT A COLUMN ADDED TO THE SHELL'S `owners` SELECT. That select feeds the
// business name, the plan and the country of every screen: if it named a column that does
// not exist yet -- the code deployed before migration 219, or dev before it runs -- the
// whole shell would lose its owner row. Here a failed read is just «off», which is what
// the business had before this feature existed.
export const getBarcodesEnabled = cache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (supabase: SupabaseClient<any, any, any>, ownerId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.from("owners").select("barcodes_enabled").eq("id", ownerId).maybeSingle();
      if (error) return false;
      return (data as { barcodes_enabled?: boolean } | null)?.barcodes_enabled === true;
    } catch {
      return false;
    }
  },
);
