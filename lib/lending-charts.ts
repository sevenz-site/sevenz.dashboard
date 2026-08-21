// Pure aggregation for the Cartera dashboard's lending chart — no I/O, same
// separation as lib/credit-score.ts. Bucketing is done in America/Bogota
// calendar days (not UTC/server time), since "today" and "this week" mean
// the owner's local day, not whatever timezone the server happens to run in.

const BOGOTA_TZ = "America/Bogota";
const DAY_MS = 24 * 60 * 60 * 1000;

// Indexed to match Date.getUTCDay() (0 = Sunday ... 6 = Saturday), since
// that's what a "YYYY-MM-DD" key parsed as UTC midnight naturally yields.
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export type WeeklyLendingPoint = { day: string; fiado: number; abono: number };

type MovementInput = { type: "charge" | "payment"; amount: number; created_at: string };

function bogotaDateKey(iso: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the sortable/parseable key
  // we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Rolling 7 days ending today (Bogota calendar days), oldest to newest —
// not the calendar week, so it never shows empty future days. Fiado
// (charges) and abono (payments) are totaled separately per day so the
// chart can show both as a grouped pair.
export function computeWeeklyFiadoAbono(
  movements: MovementInput[],
  now: Date = new Date(),
): WeeklyLendingPoint[] {
  const fiadoByDate = new Map<string, number>();
  const abonoByDate = new Map<string, number>();
  for (const m of movements) {
    const key = bogotaDateKey(m.created_at);
    const byDate = m.type === "charge" ? fiadoByDate : abonoByDate;
    byDate.set(key, (byDate.get(key) ?? 0) + m.amount);
  }

  const todayKey = bogotaDateKey(now.toISOString());
  const todayMs = new Date(`${todayKey}T00:00:00Z`).getTime();

  const points: WeeklyLendingPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const dateMs = todayMs - i * DAY_MS;
    const dateKey = new Date(dateMs).toISOString().slice(0, 10);
    points.push({
      day: WEEKDAY_LABELS[new Date(dateMs).getUTCDay()],
      fiado: fiadoByDate.get(dateKey) ?? 0,
      abono: abonoByDate.get(dateKey) ?? 0,
    });
  }
  return points;
}
