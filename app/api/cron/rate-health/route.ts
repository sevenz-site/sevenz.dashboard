import { NextResponse } from "next/server";
import { getRateHealth } from "@/lib/admin/rate-health";
import { getCreditWatch } from "@/lib/admin/credit-watch";
import { creditWatchForLog } from "@/lib/returns/credit-watch";
import { avisarTasaRetenida } from "@/lib/whatsapp/tasa-retenida";
import { getSaludDelCronWhatsapp } from "@/lib/admin/whatsapp-cron";
import { cronForLog, dailyVerdict } from "@/lib/admin/daily-health";

export const runtime = "nodejs";

// THE QUESTION GITHUB ASKS EVERY MORNING (.github/workflows/rate-health.yml).
//
// Sevenz has no channel to reach its own owner: no mail provider, and WhatsApp only sends
// templates Meta approved. A scheduled workflow that fails makes GitHub notify whoever
// created it, which costs no new vendor and needs neither his computer nor Meta. Owner's
// decision of 2026-11-05 (PL-25). Since 2026-11-06 the approved WhatsApp template goes out
// from here too: see lib/whatsapp/tasa-retenida.ts.
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

  const [health, creditWatch, cron] = await Promise.all([
    getRateHealth(),
    getCreditWatch(),
    getSaludDelCronWhatsapp(),
  ]);
  await avisarTasaRetenida(health);
  // PL-28, since 2026-11-09: the WhatsApp cron's heartbeat rides the same question. Either
  // failing answers 503, and `detail` names which one, because that line is what GitHub's
  // failure notice prints. See lib/admin/daily-health.ts for what the log may carry.
  const verdict = dailyVerdict(health, cron);
  // B OF PL-22 RIDES THE SAME MESSENGER, as a line of its own: counts and the window, never a
  // business name or an amount, because the workflow's logs are public. It does not decide the
  // status yet: a week of observation first, then the owner says whether it turns GitHub red
  // (lib/returns/credit-watch.ts).
  return NextResponse.json(
    {
      ...health,
      detail: verdict.detail,
      whatsapp_cron: cronForLog(cron),
      credit_watch: creditWatchForLog(creditWatch),
    },
    { status: verdict.failed ? 503 : 200 },
  );
}
