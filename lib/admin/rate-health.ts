import { createServiceClient } from "@/lib/supabase/service";
import { assessRateHealth, type RateHealth } from "@/lib/exchange-rate/rate-health";

// Enough for a held streak of about a week at the app's busiest: one row every 20 minutes
// while someone uses it. A longer one reads as «since at least this date», which is still an
// alarm, and the card says how many days.
const ROWS = 500;

// READS THE TABLE DIRECTLY, and that is allowed here: `bcv_exchange_rate_fetches` is the one
// table production grants to service_role (qa:service-role enforces it). It holds no customer
// data, so it needs no definer function.
export async function getRateHealth(): Promise<RateHealth> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("bcv_exchange_rate_fetches")
    .select("fetched_at, usd, eur, source, needs_review")
    .order("fetched_at", { ascending: false })
    .limit(ROWS);

  if (error) {
    // Not "all is well" and not a crash: a card that cannot read the table says so, because
    // a quiet zero here is exactly the failure this card exists to end.
    console.error("[salud tasa]:", error.message);
    return { ...assessRateHealth([]), detail: "No se pudo leer la tabla de tasas." };
  }
  return assessRateHealth(data ?? []);
}
