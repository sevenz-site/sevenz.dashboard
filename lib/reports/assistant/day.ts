// THE ASSISTANT'S DAY: the calendar date in Venezuela, not in UTC.
//
// Owner's decision of 2026-11-25. Until then the daily note was keyed on
// `new Date().toISOString().slice(0, 10)`, the UTC date, so «today's» note turned
// over at 8:00 p.m. Venezuelan time. That was invisible while the note was only
// read on opening Reportes; with the red dot on «Reportes» (same day) it would have
// announced a «new report» every evening at eight. Asked as a straight choice, he
// picked «Medianoche de Venezuela» (11 p.m. in Colombia) over leaving it.
//
// ONE ZONE FOR EVERY BUSINESS, Colombian ones included: the note is one row per
// owner and day, and the rate limiter counts per rolling 24 hours, so a per-country
// day would buy an hour of difference and a second code path.
//
// The writer (`/api/reportes/asistente`), the thumbs (`calificarAsistente`) and the
// dot (`unread.ts`) all read this function. If they ever disagree, the thumb rates
// a note that is not the one on screen, or the dot never goes away.
export function assistantDay(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, which is what the `date` column takes.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
