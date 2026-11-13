import type { RateHealth } from "@/lib/exchange-rate/rate-health";
import type { SaludDelCron } from "@/lib/admin/whatsapp-cron";

// THE DAILY CHECK'S VERDICT: THE RATE AND THE WHATSAPP CRON — PL-28.
//
// Until 2026-11-09 `/api/cron/rate-health` only asked about the rate, and the rate
// refreshes itself whenever a shopkeeper opens the app (`ensure-fresh.ts`), so a dead
// cron never left it stale. `/api/cron/whatsapp` could stop — a 401, Vercel skipping it —
// and no reminder went out, no expired account was processed, and GitHub stayed green.
// Owner's decision of 2026-11-07: it goes in the fixes release, through the same mail.
//
// The cron's heartbeat is `whatsapp_cron_runs` (migration 071), already read for /admin
// by `getSaludDelCronWhatsapp`. Its «fail» is the alarm: more than 26 h since the last
// run, never run, or the last run errored. Its «warn» (failed sends this week) does NOT
// turn GitHub red: a single rejected number is not the cron being down.
//
// WHEN A MISSED DAY IS CAUGHT. The cron fires at 13:xx UTC (vercel.json); the check runs
// at 14:30 and 17:17 UTC (.github/workflows/rate-health.yml). If today's run never
// happens, at 14:30 the last one is ~25 h old — under 26, green — and at 17:17 it is
// ~27–28 h: red the same day. That is what the second time buys.
//
// WHAT THE LOG MAY CARRY. The repo is public and so are its workflow logs, so the cron's
// part holds a state, a date and hours only. No counts — not even of failed sends — and
// never the error text, which could name a business or a number.

export type CronForLog = {
  status: SaludDelCron["estado"];
  last_run: string | null;
  hours_since_last: number | null;
  last_run_failed: boolean;
};

export function cronForLog(cron: SaludDelCron): CronForLog {
  return {
    status: cron.estado,
    last_run: cron.ultimaCorrida,
    hours_since_last: cron.horasDesdeUltima == null ? null : Math.round(cron.horasDesdeUltima),
    last_run_failed: cron.ultimoError != null,
  };
}

// The cron's own sentence, without the one branch that carries a count.
function cronDetail(cron: SaludDelCron): string {
  // No hours means one of two things, and `getSaludDelCronWhatsapp` already says which in
  // `detalle`: «nunca se ha disparado» or «no pudimos leer el estado del cron». Neither
  // carries a count.
  if (cron.horasDesdeUltima == null) return `Cron de WhatsApp: ${cron.detalle}.`;
  const horas = Math.round(cron.horasDesdeUltima);
  if (cron.horasDesdeUltima >= 26) return `Cron de WhatsApp: no corre desde hace ${horas} h.`;
  if (cron.ultimoError != null) return "Cron de WhatsApp: la última corrida terminó con error.";
  return "Cron de WhatsApp: no pudimos leer su estado.";
}

export function dailyVerdict(
  rate: RateHealth,
  cron: SaludDelCron,
): { failed: boolean; detail: string } {
  const rateFailed = rate.status === "fail";
  const cronFailed = cron.estado === "fail";
  const parts = [rateFailed ? rate.detail : null, cronFailed ? cronDetail(cron) : null].filter(
    (p): p is string => p != null,
  );
  // With nothing failing, the rate's own line, as before this check existed.
  return { failed: rateFailed || cronFailed, detail: parts.length ? parts.join(" ") : rate.detail };
}
