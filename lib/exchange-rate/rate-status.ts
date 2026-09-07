// What the rate on screen is, relative to today — and nothing else. Its own
// module, with no Next or Supabase imports, so the decision can be imported
// and tested on its own (see qa/rate-status.mjs). The case that matters most,
// the BCV not publishing, cannot be observed on a day it does publish.
//
//   current        the rate is today's. Nothing to explain, no note shown.
//   no_publication older than today, and we confirmed with the provider that
//                  this IS the newest published. The BCV took the weekend or a
//                  holiday off; everything is working correctly.
//   unconfirmed    older than today, and we could NOT confirm. There may be a
//                  newer rate we failed to fetch. Identical symptom, opposite
//                  meaning — and telling an owner "the BCV doesn't publish on
//                  weekends" while the truth is "our fetch is broken" would
//                  hide the failure exactly when it costs them money.
export type RateStatus = "current" | "no_publication" | "unconfirmed";

// `confirmed` means the provider agreed with our rate_date inside the last
// refresh window. Without it an older date is ambiguous between the two cases
// above, so it resolves to the one that admits we do not know.
export function rateStatusFor(
  rateDate: string | null,
  today: string,
  confirmed: boolean,
): RateStatus {
  if (rateDate === null) return "unconfirmed";
  // >= rather than ===: if the provider is ever a day ahead of our clock, that
  // is not staleness and must not be reported as any kind of problem.
  if (rateDate >= today) return "current";
  return confirmed ? "no_publication" : "unconfirmed";
}

// Today's calendar day in Venezuela, "YYYY-MM-DD". en-CA yields ISO order; the
// timeZone is the part that matters, since Vercel runs in UTC and would roll
// over to tomorrow at 8 p.m. Caracas — showing a weekend note on a Friday
// evening for a rate that is perfectly current.
export function todayInCaracas(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
