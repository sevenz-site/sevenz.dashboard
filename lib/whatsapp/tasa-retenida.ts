import type { RateHealth } from "@/lib/exchange-rate/rate-health";
import { formatBs } from "@/lib/exchange-rate/format";
import type { ParametroPlantilla } from "@/lib/whatsapp/kapso";
import { enviarAvisoAlDueno } from "@/lib/whatsapp/send";

// THE RATE ALERT, BY WHATSAPP (PL-25). `tasa_retenida_aviso`, approved by Meta as Utility on
// 2026-11-06. It goes to the owner of Sevenz, never to a shopkeeper, so it does not count
// towards the two-a-week rule of CLAUDE.md.
//
// CALLED FROM TWO PLACES, ON PURPOSE. `/api/cron/rate-health` answers GitHub, and on
// 2026-11-06 GitHub had not started the scheduled run an hour after its time, as its own
// documentation warns can happen. `/api/cron/whatsapp` runs on Vercel, a different clock. The
// period key is the day, so whichever comes first sends and the other is skipped.
//
// TWO VARIABLES, BOTH NEEDED, AND WITHOUT THEM NOTHING IS SENT:
//   RATE_ALERT_WHATSAPP_TO   the number, in digits. It stays out of the repo, which is public.
//   RATE_ALERT_OWNER_ID      the account the send is filed under: `whatsapp_sends` hangs from
//                            `owners`. An id and not an email to look up, because production
//                            refuses `service_role` a read of `owners` (migration 039).

const OFFSET_COLOMBIA_MS = -5 * 3_600_000;
const NOMBRE: Record<string, string> = { usd: "el dólar", eur: "el euro" };

function fechaEscrita(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "America/Bogota" });
}

/**
 * The template's four values, or null when there is nothing to say.
 *
 * The body reads «{{currency}} lleva {{hours}} sin actualizarse», singular. With both
 * currencies held, or the whole rate stopped, the subject is «la tasa», so the sentence still
 * agrees. `null` with no rate at all: the template has to name a figure, and «Sin datos» has
 * none. GitHub's failure covers that one.
 */
export function parametrosDeTasaRetenida(
  health: RateHealth,
  ahora = new Date(),
): ParametroPlantilla[] | null {
  if (health.status !== "fail") return null;
  if (health.usd == null || health.eur == null) return null;

  const retenida = health.label === "Retenida" ? health.heldCurrencies : [];
  const unaSola = retenida.length === 1 ? retenida[0] : null;

  const horas =
    health.label === "Retenida"
      ? health.heldHours
      : health.label === "Detenida"
        ? health.hoursSinceFetch
        : health.reviewSince
          ? (ahora.getTime() - new Date(health.reviewSince).getTime()) / 3_600_000
          : null;
  if (horas == null) return null;

  const desde =
    health.label === "Retenida"
      ? health.heldSince
      : health.label === "Detenida"
        ? new Date(ahora.getTime() - horas * 3_600_000).toISOString()
        : health.reviewSince;
  if (!desde) return null;

  const cifra =
    unaSola === "usd"
      ? formatBs(health.usd)
      : unaSola === "eur"
        ? formatBs(health.eur)
        : `${formatBs(health.usd)} el dólar y ${formatBs(health.eur)} el euro`;

  return [
    { nombre: "currency", texto: unaSola ? (NOMBRE[unaSola] ?? "la tasa") : "la tasa" },
    { nombre: "hours", texto: `${Math.round(horas)} horas` },
    { nombre: "held_rate", texto: cifra },
    { nombre: "since_date", texto: fechaEscrita(desde) },
  ];
}

/** Never throws: an alert that cannot leave must not take a cron down with it. */
export async function avisarTasaRetenida(health: RateHealth, ahora = new Date()): Promise<string> {
  try {
    const parametros = parametrosDeTasaRetenida(health, ahora);
    if (!parametros) return "sin_aviso";

    const to = process.env.RATE_ALERT_WHATSAPP_TO?.trim();
    const ownerId = process.env.RATE_ALERT_OWNER_ID?.trim();
    if (!to || !ownerId) {
      console.error("[tasa retenida] sin RATE_ALERT_WHATSAPP_TO o RATE_ALERT_OWNER_ID: no se avisó.");
      return "sin_configurar";
    }

    const dia = new Date(ahora.getTime() + OFFSET_COLOMBIA_MS).toISOString().slice(0, 10);
    const resultado = await enviarAvisoAlDueno({
      ownerId,
      to,
      plantilla: "tasa_retenida_aviso",
      periodKey: `tasa-${dia}`,
      parametrosCuerpo: parametros,
    });
    return resultado.estado === "omitido" ? resultado.motivo : resultado.estado;
  } catch (error) {
    console.error("[tasa retenida]", error instanceof Error ? error.message : error);
    return "fallido";
  }
}
