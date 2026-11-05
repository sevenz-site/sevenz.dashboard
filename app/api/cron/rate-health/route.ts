import { NextResponse } from "next/server";
import { getRateHealth } from "@/lib/admin/rate-health";

export const runtime = "nodejs";

// THE QUESTION GITHUB ASKS EVERY MORNING (.github/workflows/rate-health.yml).
//
// Sevenz has no channel to reach its own owner: no mail provider, and WhatsApp only sends
// templates Meta approved. A scheduled workflow that fails makes GitHub notify whoever
// created it, which costs no new vendor and needs neither his computer nor Meta. Owner's
// decision of 2026-11-05 (PL-25); the WhatsApp template `tasa_retenida_aviso` is drafted in
// ../docs/WHATSAPP-PLANTILLAS.md for when it is approved.
//
// 503 IS THE MESSAGE: the workflow fails on anything but 200, so a held rate past 24 hours
// and a dead route both reach the owner. Read-only, behind CRON_SECRET like every cron route,
// and the body holds rates and dates only, because a public repo's workflow logs are public.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const health = await getRateHealth();
  return NextResponse.json(health, { status: health.status === "fail" ? 503 : 200 });
}
