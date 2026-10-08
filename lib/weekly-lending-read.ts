import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeMonthlyFiadoAbono,
  computeWeeklyFiadoAbono,
  lendingFetchWindowStart,
  type LendingPeriod,
  type WeeklyLendingPoint,
} from "@/lib/lending-charts";

// READING THE WEEK'S MOVEMENTS FOR THE CHARTS — the I/O half of
// `lib/lending-charts.ts`, which stays pure.
//
// It lives in its own file because TWO screens draw these charts since
// 2026-10-03: Inicio, which has always had them, and `/reportes`, which is
// where delivery 3 of the redesign moves them. The query, the window and the
// per-currency split were written inline in the dashboard page; copying them to
// the second screen is how the two start answering differently.
//
// The failure that would cause is not a crash, which is why it is worth a file:
// a `/reportes` whose fetch window were a day narrower than Inicio's would
// simply draw a slightly different week, and both pages would look right.

export type WeeklyLending = {
  cop: WeeklyLendingPoint[];
  usd: WeeklyLendingPoint[];
  eur: WeeklyLendingPoint[];
  // Whether any bar the charts draw is above zero. The charts cannot say this
  // themselves: a week with no movements and a week of nothing but zeroes draw
  // the same flat axis, and only one of them means "there is nothing to show".
  //
  // IT IS COMPUTED FROM THE SERIES, NOT FROM THE ROWS, and that is the whole
  // point of the field. The fetch window is NINE days — deliberately wider than
  // the seven the chart buckets, so a movement near either boundary cannot fall
  // out of it (see `chartFetchWindowStart`). So `rows.length > 0` answers a
  // different question: "was there anything in the last NINE days". A shop
  // whose only recent movement is eight days old would get `true` from it and
  // be shown seven flat bars, with the empty state suppressed because something
  // had technically been found.
  //
  // Not observed happening — it comes from reading the two windows against each
  // other, and the first version of this file did use `rows.length`. Deriving
  // it from the series removes the question instead of answering it: the flag
  // now means "at least one bar is above zero", which is the only thing the
  // empty state is ever deciding about.
  anyInPeriod: boolean;
};

const EMPTY: WeeklyLending = { cop: [], usd: [], eur: [], anyInPeriod: false };

export async function readWeeklyLending(
  supabase: SupabaseClient,
  // The client ids in scope. Passed in rather than queried here because both
  // callers already have them for their own reasons — and because `/reportes`
  // narrows this list to one client when the owner filters by name.
  clientIds: string[],
  // Which window, and therefore how the bars are grouped: a bar per day over 7
  // days, or five six-day buckets over 30. Carried in the URL, so the server
  // does the work and the back button behaves.
  period: LendingPeriod,
): Promise<WeeklyLending> {
  if (clientIds.length === 0) return EMPTY;

  // Only the window the chart actually draws. This query used to have no date
  // filter at all: it pulled every movement the shop had ever recorded — 411 ms
  // and climbing forever on a 10,560-movement shop — to render a rolling 7-day
  // chart.
  const { data } = await supabase
    .from("movements")
    .select("type, amount, currency, created_at")
    .in("client_id", clientIds)
    .is("deleted_at", null)
    .gte("created_at", lendingFetchWindowStart(period));

  const rows = (data ?? []) as {
    type: "charge" | "payment";
    amount: number;
    currency: "USD" | "EUR" | null;
    created_at: string;
  }[];

  // The chart sums raw movement amounts, which only means something within one
  // currency — a VE owner gets one chart per currency, each filtered to its own
  // movements and never converted, instead of one mixed total.
  const bucket = period === "30d" ? computeMonthlyFiadoAbono : computeWeeklyFiadoAbono;
  const cop = bucket(rows.filter((m) => !m.currency));
  const usd = bucket(rows.filter((m) => m.currency === "USD"));
  const eur = bucket(rows.filter((m) => m.currency === "EUR"));

  return {
    cop,
    usd,
    eur,
    anyInPeriod: [cop, usd, eur].some((series) =>
      series.some((point) => point.fiado > 0 || point.abono > 0),
    ),
  };
}

// Has this shop EVER registered a movement? Only `/reportes` asks, and only to
// pick which empty state to show.
//
// The distinction is not decoration. "Esta semana no has registrado nada" to an
// owner who signed up yesterday reads as a reproach for a week they were not
// here for; "aquí verás tu actividad" to an owner with eight months of history
// and a quiet week reads as if the app had lost their data. They are different
// sentences because they are different situations.
export async function hasAnyMovement(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<boolean> {
  if (clientIds.length === 0) return false;
  // `head: true` asks for the count and no rows, so this stays cheap on a shop
  // with ten thousand movements. `limit(1)` on top of it because the exact
  // number is never used — only whether it is above zero.
  const { count } = await supabase
    .from("movements")
    .select("id", { count: "exact", head: true })
    .in("client_id", clientIds)
    .is("deleted_at", null)
    .limit(1);
  return (count ?? 0) > 0;
}
