import "server-only";
import { sendMondayMessages, type WeeklyBatchResult } from "@/lib/whatsapp/business-weekly";

// THE MONDAY MESSAGE, under the name every caller already uses: the daily cron, the
// standalone `/api/cron/whatsapp-cartera-summary` and `qa:whatsapp-plantillas`.
//
// Since 2026-11-13 (v0.6.0) it lives in `business-weekly.ts`, and which template goes is in
// `business-weekly-text.ts`, `mondayPlan`: `negocio_resumen` for a real account with
// something owed, `cartera_pausada` for a paused one, and `cartera_summary_v2`, unchanged,
// for everybody else. The history of the last two -- why `customer_name`, why a blocked
// account is still written to every week -- is in git (`git log -p` on this file) and in
// the comments that moved with them.

export type ResumenDeLaTanda = WeeklyBatchResult;

export function enviarResumenSemanal(): Promise<ResumenDeLaTanda> {
  return sendMondayMessages();
}
