import "server-only";
import { sendThursdayMessages, type WeeklyBatchResult } from "@/lib/whatsapp/business-weekly";

// THE THURSDAY MESSAGE, under the name every caller already uses: the daily cron, the
// standalone `/api/cron/whatsapp-cartera-attention` and `qa:whatsapp-plantillas`.
//
// `cartera_attention` IS NO LONGER SENT from 2026-11-13 (v0.6.0). `atencion_cobros` and
// `atencion_negocio` replace it, chosen in `business-weekly-text.ts`, `thursdayPlan`. What
// the old one carried and the new ones drop: «Clientes que vieron su saldo esta semana y no
// abonaron». The spec of the family has no such line; said in the report that day.
//
// What carries over unchanged: the paused owner gets nothing on Thursday (`cartera_pausada`
// on Monday stands for both days), and an owner with nothing to collect gets nothing.

export type ResumenDeLaTanda = WeeklyBatchResult;

export function enviarAtencionSemanal(): Promise<ResumenDeLaTanda> {
  return sendThursdayMessages();
}
