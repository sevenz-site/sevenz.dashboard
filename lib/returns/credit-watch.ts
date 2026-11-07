import { formatDateLong, zonaDelNegocio } from "@/lib/format";
import { formatPriceAmount } from "@/lib/products/price";

// WHICH CREDIT BALANCES BORN FROM A RETURN ARE WORTH A LOOK. Pure, so qa/credit-watch.mjs
// runs every edge without a database.
//
// B of PL-22, owner's decision of 2026-11-05: *«Vamos con B, C1 y C2. B nunca debe bloquear
// transacciones, solo avisar a admin»*. Finding A4 of the returns audit: with a stolen
// session a sale can be fabricated, returned «a favor» and spent, and the ledger cannot tell
// it from a real one. What CAN be seen is the shape: a large credit balance born from a
// return of a sale registered minutes earlier. Almost always that is a sale typed wrong and
// corrected on the spot, which is why this counts and never refuses.
//
// BUSINESS QUESTION, in the owner's words of 2026-11-05: «avisar a admin». What it decides:
// if a row shows up and the owner of Sevenz does not recognise the sale, he closes that
// account's sessions («Cerrar sesión en todos», 2026-11-02) and asks the shopkeeper. If weeks
// go by with only corrections in this list, the thresholds below are too low and get raised;
// if the list stays empty for months, B stays as a cheap floor and nothing more is built on it.
//
// THE RULE LIVES HERE AND IS PASSED TO SQL. `admin_credit_watch` (migration 191) takes the
// four numbers as parameters, so the /admin card, the daily GitHub check and the QA suite ask
// the same question. The filter is applied here AGAIN on purpose: belt and braces, and the
// suite can prove the rule without a database.
//
// STATUS IS NEVER "fail". The daily check reports the count and keeps passing: a week of
// observation first, to measure how many legitimate corrections fall inside, and only then
// does the owner decide whether it should turn GitHub red. Owner's decision of 2026-11-05.

export const CREDIT_WATCH_WINDOW_DAYS = 7;
/** Floor for a USD or EUR ledger. Proposed on 2026-11-05; the owner can move it. */
export const CREDIT_WATCH_MIN_CREDIT = 20;
/** A COP ledger stores pesos (currency null), where 20 is nothing. Roughly the same money. */
export const CREDIT_WATCH_MIN_CREDIT_COP = 80_000;
/** How fresh the sale has to be for its return to look like a correction, or a fabrication. */
export const CREDIT_WATCH_MAX_HOURS = 24;

export type CreditWatchRow = {
  business_name: string | null;
  owner_country: string | null;
  currency: "USD" | "EUR" | null;
  to_credit: number | string;
  sale_created_at: string | null | undefined;
  returned_at: string | null | undefined;
};

export type CreditWatch = {
  status: "ok" | "warn";
  count: number;
  /** Under the number in /admin: counts and recency, Spanish, no names. */
  detail: string;
  /** The card's popover: what the number means, with an example, in plain words. */
  explain: string;
  /** One sentence per case, newest first, at most five. These name the business. */
  items: string[];
  /** True when the table could not be read: the card must not look like a quiet zero. */
  readFailed: boolean;
};

const MAX_ITEMS = 5;

export const CREDIT_WATCH_EXPLAIN =
  "Devoluciones que dejaron un saldo a favor de $20 o más (80.000 pesos en Colombia) sobre una " +
  "venta registrada menos de 24 horas antes, en los últimos 7 días. Por ejemplo: una venta de " +
  "$5.000 que se devolvió como saldo a favor 3 minutos después de registrarse. Casi siempre es " +
  "una venta mal anotada y corregida al momento. Si no reconoces la venta, cierra las sesiones " +
  "de esa cuenta y pregúntale al tendero. Esta tarjeta solo cuenta: nunca bloquea una devolución.";

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

function elapsedText(hours: number): string {
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return m === 1 ? "1 minuto" : `${m} minutos`;
  }
  const h = Math.round(hours);
  return h === 1 ? "1 hora" : `${h} horas`;
}

function agoText(hours: number): string {
  if (hours < 1) return "hace menos de una hora";
  if (hours < 24) return `hace ${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function moneyText(amount: number, currency: "USD" | "EUR" | null): string {
  if (currency === null) return `${amount.toLocaleString("es-CO", { maximumFractionDigits: 0 })} pesos`;
  return formatPriceAmount(amount, currency);
}

type Case = { credit: number; currency: "USD" | "EUR" | null; business: string; country: string | null; sale: Date; returned: Date };

function parseRow(row: CreditWatchRow, now: Date): Case | null {
  const credit = Number(row.to_credit);
  if (!Number.isFinite(credit)) return null;
  const sale = row.sale_created_at ? new Date(row.sale_created_at) : null;
  const returned = row.returned_at ? new Date(row.returned_at) : null;
  if (!sale || !returned || Number.isNaN(sale.getTime()) || Number.isNaN(returned.getTime())) return null;
  const currency = row.currency === "USD" || row.currency === "EUR" ? row.currency : null;
  const floor = currency === null ? CREDIT_WATCH_MIN_CREDIT_COP : CREDIT_WATCH_MIN_CREDIT;
  if (credit < floor) return null;
  // Strictly inside the window and the sale's age, inclusive at the edge: a sale returned
  // exactly 24 hours later still counts, so the SQL and this agree.
  if (hoursBetween(returned, now) > CREDIT_WATCH_WINDOW_DAYS * 24) return null;
  if (hoursBetween(sale, returned) > CREDIT_WATCH_MAX_HOURS + 1e-9) return null;
  return { credit, currency, business: row.business_name?.trim() || "un negocio sin nombre", country: row.owner_country ?? null, sale, returned };
}

export function assessCreditWatch(rows: CreditWatchRow[], now: Date = new Date()): CreditWatch {
  const cases = rows
    .map((r) => parseRow(r, now))
    .filter((c): c is Case => c !== null)
    .sort((a, b) => b.returned.getTime() - a.returned.getTime());

  const items = cases.slice(0, MAX_ITEMS).map((c) => {
    const zona = zonaDelNegocio(c.country);
    const when = formatDateLong(c.returned.toISOString(), zona);
    const gap = elapsedText(hoursBetween(c.sale, c.returned));
    return `El ${when}, en «${c.business}», una venta de ${moneyText(c.credit, c.currency)} se devolvió como saldo a favor ${gap} después de registrarse.`;
  });

  const count = cases.length;
  const detail =
    count === 0
      ? `ninguna en ${CREDIT_WATCH_WINDOW_DAYS} días`
      : `${count} en ${CREDIT_WATCH_WINDOW_DAYS} días · la más reciente ${agoText(hoursBetween(cases[0].returned, now))}`;

  return {
    status: count === 0 ? "ok" : "warn",
    count,
    detail,
    explain: CREDIT_WATCH_EXPLAIN,
    items,
    readFailed: false,
  };
}

/**
 * What the daily GitHub check may print. Its logs are public (the repo is), so this carries
 * counts and the window and never a business name or an amount.
 */
export function creditWatchForLog(watch: CreditWatch): { count: number; windowDays: number; readFailed: boolean } {
  return { count: watch.count, windowDays: CREDIT_WATCH_WINDOW_DAYS, readFailed: watch.readFailed };
}
