// HOW MANY TRIAL DAYS ARE LEFT, counted in the business's own calendar.
//
// The trial ends at 23:59:59 of its last day in Caracas or Bogotá (migration
// 171, `fin_de_prueba`). Counting with UTC dates would move the end a day for
// anyone opening the app after 8 p.m. in Caracas -- the same trap 168 fixed
// for the WhatsApp reminder.
//
// 0 means «today is the last day», 1 «tomorrow». null means there is nothing to
// say: no trial, or a date that cannot be read.

export const TRIAL_NOTICE_DAYS = 14;

function businessDay(date: Date, country: string | null | undefined): string {
  // sv-SE prints YYYY-MM-DD, which compares and subtracts cleanly.
  return date.toLocaleDateString("sv-SE", {
    timeZone: country === "VE" ? "America/Caracas" : "America/Bogota",
  });
}

export function trialDaysLeft(
  endsAt: string | null | undefined,
  country: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  const days =
    (Date.parse(businessDay(end, country)) - Date.parse(businessDay(now, country))) / 86_400_000;
  return days < 0 ? null : Math.round(days);
}
