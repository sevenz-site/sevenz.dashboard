"use client";

import dynamic from "next/dynamic";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";

// The charting library is 368 KB — the second largest thing the app ships — so
// it is loaded on demand here too, even though on `/reportes` it is wanted
// every time. The point is not to delay it: it is that `ssr: false` keeps
// recharts off the server render, where `ResponsiveContainer` has no width to
// measure and draws nothing anyway.
//
// The placeholder mirrors the real chart's box rather than declaring a height
// of its own, so the page does not shove itself around when the library lands.
const WeeklyLendingChart = dynamic(
  () => import("@/components/dashboard/lending-bar-chart").then((m) => m.WeeklyLendingChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-w-64 flex-1 flex-col gap-2 rounded-lg border p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[180px] w-full animate-pulse rounded bg-muted/50" />
      </div>
    ),
  },
);

// The week's charts, one per ledger the shop actually keeps.
//
// `perCurrency` is the same decision Inicio's capital card makes: a VE shop keeps
// USD and EUR as two independent ledgers, and summing them would produce a
// number that is not money in any currency. A CO shop has one.
//
// Stacked on a phone, side by side once there is room — two ledgers are not a
// sequence, so they read better abreast on a wide screen.
//
// EVERY CHART GETS A ROW OF ITS OWN, and that is not a stylistic wrapper.
// `WeeklyLendingChart`'s outer box carries `flex-1`, which was written for the
// capital card, where it shared a row. Dropped straight into this page — a
// `flex flex-1 flex-col` column — that `flex-1` grows along the COLUMN instead,
// and one chart with a 180px plot stretched into a 560px card of white space.
// Wrapping each one in a row means `flex-1` always divides width, never height.
export function WeeklyLendingCharts({
  perCurrency,
  cop,
  usd,
  eur,
}: {
  perCurrency: boolean;
  cop: WeeklyLendingPoint[];
  usd: WeeklyLendingPoint[];
  eur: WeeklyLendingPoint[];
}) {
  const row = (data: WeeklyLendingPoint[], title: string) => (
    <div className="flex w-full min-w-0 lg:flex-1">
      <WeeklyLendingChart data={data} title={title} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {perCurrency ? (
        <>
          {row(usd, "Fiado vs. Abono (USD)")}
          {row(eur, "Fiado vs. Abono (EUR)")}
        </>
      ) : (
        row(cop, "Fiado vs. Abono de la semana")
      )}
    </div>
  );
}
