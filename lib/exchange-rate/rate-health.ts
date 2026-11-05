// IS THE RATE THE APP SHOWS TODAY'S RATE? Pure, so qa/fuentes-tasa.mjs runs every branch.
//
// A held rate is the right call and a silent one: resolve-rates.ts keeps the last good number
// rather than stamp a fiado with a broken one, and from then on the shopkeeper sees
// yesterday's figure with today's date on it. Nothing is red. On 2026-11-05 that gap was
// already Bs. 6,26 per euro after one day, and it grows every day the source stays broken.
// Owner's decision of that day: this has to reach a person (PL-25) and be readable in /admin
// (PL-26), and no release goes out without it.
//
// IT READS THE TABLE AND NOTHING ELSE, on purpose. Every row already says how it was decided
// in its `source` column («dolarapi+dolarvzla+bcv», «dolarvzla held:eur»), so there is no new
// column, no migration, and the answer is the same from the card, the route and the daily
// diagnosis.
export const ALERT_AFTER_HOURS = 24;
// The refresh runs once a day at worst, through the cron. Past this the cron itself stopped.
export const STALE_AFTER_HOURS = 30;

export type RateRow = {
  fetched_at: string;
  usd: number | string;
  eur: number | string;
  source: string | null;
  needs_review: boolean;
};

export type RateHealth = {
  status: "ok" | "warn" | "fail";
  // The card's big word, decided here so the card has no logic of its own to get wrong.
  label: string;
  // What the app is showing: the newest row that was not sent to review.
  usd: number | null;
  eur: number | null;
  sources: string[];
  heldCurrencies: string[];
  heldSince: string | null;
  heldHours: number | null;
  reviewRows: number;
  reviewSince: string | null;
  hoursSinceFetch: number | null;
  // One line, Spanish: the owner reads it in /admin and in GitHub's failure notice.
  detail: string;
};

function heldIn(source: string | null): string[] {
  return source?.match(/held:([a-z,]+)/)?.[1].split(",") ?? [];
}

function sourcesIn(source: string | null): string[] {
  const first = source?.split(" ")[0] ?? "";
  return first && first !== "ninguna" ? first.split("+") : [];
}

function hoursBetween(from: string, now: Date): number {
  return (now.getTime() - new Date(from).getTime()) / 3_600_000;
}

function hoursText(hours: number): string {
  return hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} días`;
}

const NAME: Record<string, string> = { usd: "dólar", eur: "euro" };

function readings(n: number): string {
  return n === 1 ? "1 lectura" : `${n} lecturas`;
}

// `rows` come newest first. A streak is walked back from the newest row and ends at the first
// row that breaks it, so a rate that was held last week and recovered says nothing today.
export function assessRateHealth(rows: RateRow[], now = new Date()): RateHealth {
  const empty = { usd: null, eur: null, sources: [], heldCurrencies: [], heldSince: null, heldHours: null, reviewRows: 0, reviewSince: null };
  if (rows.length === 0) {
    return { ...empty, status: "fail", label: "Sin datos", hoursSinceFetch: null, detail: "No hay ninguna tasa guardada." };
  }

  const hoursSinceFetch = hoursBetween(rows[0].fetched_at, now);

  let reviewRows = 0;
  while (reviewRows < rows.length && rows[reviewRows].needs_review) reviewRows++;
  const reviewSince = reviewRows ? rows[reviewRows - 1].fetched_at : null;
  const reviewHours = reviewSince ? hoursBetween(reviewSince, now) : null;

  const accepted = rows.filter((r) => !r.needs_review);
  const current = accepted[0] ?? null;
  const heldCurrencies = current ? heldIn(current.source) : [];
  let heldSince: string | null = null;
  if (heldCurrencies.length) {
    for (const row of accepted) {
      if (!heldCurrencies.some((c) => heldIn(row.source).includes(c))) break;
      heldSince = row.fetched_at;
    }
  }
  const heldHours = heldSince ? hoursBetween(heldSince, now) : null;

  const base = {
    usd: current ? Number(current.usd) : null,
    eur: current ? Number(current.eur) : null,
    sources: current ? sourcesIn(current.source) : [],
    heldCurrencies,
    heldSince,
    heldHours,
    reviewRows,
    reviewSince,
    hoursSinceFetch,
  };

  if (hoursSinceFetch > STALE_AFTER_HOURS) {
    return { ...base, status: "fail", label: "Detenida", detail: `La tasa no se refresca hace ${hoursText(hoursSinceFetch)}: el cron dejó de correr.` };
  }
  if (reviewHours !== null && reviewHours >= ALERT_AFTER_HOURS) {
    return { ...base, status: "fail", label: "En revisión", detail: `${readings(reviewRows)} en revisión seguidas desde hace ${hoursText(reviewHours)}: ninguna fuente convence y no hay cifra que retener.` };
  }
  if (heldHours !== null) {
    const what = heldCurrencies.map((c) => `el ${NAME[c] ?? c}`).join(" y ");
    const verb = heldCurrencies.length > 1 ? "llevan" : "lleva";
    const detail = `${what[0].toUpperCase()}${what.slice(1)} ${verb} ${hoursText(heldHours)} sin moverse: la app enseña la última cifra buena, no la de hoy.`;
    return { ...base, status: heldHours >= ALERT_AFTER_HOURS ? "fail" : "warn", label: "Retenida", detail };
  }
  if (reviewHours !== null) {
    return { ...base, status: "warn", label: "En revisión", detail: `${readings(reviewRows)} en revisión desde hace ${hoursText(reviewHours)}.` };
  }
  if (base.sources.length === 1) {
    return { ...base, status: "warn", label: "1 fuente", detail: `La tasa de hoy tiene un solo testigo (${base.sources[0]}).` };
  }
  return { ...base, status: "ok", label: `${base.sources.length} fuentes`, detail: `Al día, con ${base.sources.length} fuentes (${base.sources.join(", ")}).` };
}
