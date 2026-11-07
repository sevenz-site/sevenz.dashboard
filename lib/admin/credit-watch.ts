import { createServiceClient } from "@/lib/supabase/service";
import {
  assessCreditWatch,
  CREDIT_WATCH_MAX_HOURS,
  CREDIT_WATCH_MIN_CREDIT,
  CREDIT_WATCH_MIN_CREDIT_COP,
  CREDIT_WATCH_WINDOW_DAYS,
  type CreditWatch,
  type CreditWatchRow,
} from "@/lib/returns/credit-watch";

// THE /admin READ FOR B OF PL-22. Through the definer of migration 191 and never a select on
// `sale_returns`: production grants service_role no customer table (qa:service-role), and
// `lib/admin/whatsapp-cron.ts` tells how that already took /admin down once (migration 039).
//
// The four numbers travel from lib/returns/credit-watch.ts so SQL asks exactly the question
// the card explains. Read-only: this never writes, and nothing here can refuse a return.
export async function getCreditWatch(): Promise<CreditWatch> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("admin_credit_watch", {
    p_days: CREDIT_WATCH_WINDOW_DAYS,
    p_min_credit: CREDIT_WATCH_MIN_CREDIT,
    p_min_credit_cop: CREDIT_WATCH_MIN_CREDIT_COP,
    p_max_hours: CREDIT_WATCH_MAX_HOURS,
  });

  if (error) {
    // Not a quiet zero: a card that cannot read says so, in red, because "nothing to look
    // at" and "could not look" are the two answers this card exists to tell apart.
    console.error("[saldos a favor]:", error.message);
    return { ...assessCreditWatch([]), detail: "No se pudieron leer las devoluciones.", readFailed: true };
  }
  return assessCreditWatch((data ?? []) as CreditWatchRow[]);
}
