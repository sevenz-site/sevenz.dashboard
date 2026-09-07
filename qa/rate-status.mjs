// Pure-logic check for the calculator's rate note. No database, no network —
// this exists because the case that matters most (the BCV not publishing) is
// unobservable on a day it does publish, which is four days out of five.
import { rateStatusFor } from "../lib/exchange-rate/rate-status.ts";

const CASES = [
  // [rateDate, today, confirmed, expected, why]
  ["2026-09-07", "2026-09-07", true, "current", "rate is today's — no note at all"],
  ["2026-09-07", "2026-09-07", false, "current", "today's rate needs no confirmation to be today's"],
  ["2026-09-04", "2026-09-06", true, "no_publication", "Sunday: Friday's rate, confirmed newest — the BCV rested"],
  ["2026-09-04", "2026-09-07", true, "no_publication", "Monday before the cron: still the newest published"],
  ["2026-09-04", "2026-09-07", false, "unconfirmed", "same screen, opposite meaning — we could not reach the provider"],
  ["2026-03-27", "2026-04-02", true, "no_publication", "Semana Santa: six days old and still correct"],
  [null, "2026-09-07", true, "unconfirmed", "row stored before 046, or currency-api — no date to trust"],
  [null, "2026-09-07", false, "unconfirmed", "no date and no confirmation"],
  [undefined, "2026-09-07", true, "unconfirmed", "046 not run: the column does not exist and the value is undefined, not null"],
  [undefined, "2026-09-07", false, "unconfirmed", "same, unconfirmed"],
  ["", "2026-09-07", true, "unconfirmed", "empty string is not a date either"],
  ["2026-09-08", "2026-09-07", true, "current", "provider ahead of our clock never reads as stale"],
];

let failed = 0;
for (const [rateDate, today, confirmed, expected, why] of CASES) {
  const got = rateStatusFor(rateDate, today, confirmed);
  const pass = got === expected;
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${String(rateDate).padEnd(10)} vs ${today} confirmed=${String(confirmed).padEnd(5)} -> ${got.padEnd(15)} ${why}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exitCode = 1;
