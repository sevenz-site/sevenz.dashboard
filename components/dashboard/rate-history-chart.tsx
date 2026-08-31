"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getRateHistory, type RateHistoryPoint } from "@/lib/exchange-rate/rate-history";

// Two independent rates, not parts of a whole — plain lines, never a
// stacked area (stacking would render EUR on top of USD, i.e. their sum,
// not EUR's own value). Blue/amber instead of the theme's grayscale
// --chart-1/--chart-2 tokens (this app's palette never gave those real
// hue), matching the emerald/destructive precedent in lending-bar-chart.tsx
// of picking real semantic colors over the unstyled chart tokens.
const chartConfig = {
  usd: { label: "USD", color: "var(--color-blue-500)" },
  eur: { label: "EUR", color: "var(--color-amber-500)" },
} satisfies ChartConfig;

const tickFormatter = (value: string) =>
  new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));

// Whole bolívares, no decimals — an axis tick is a scale reference, not a
// precise figure (the tooltip already shows the exact value on hover).
const yAxisFormatter = (value: number) => Math.round(value).toLocaleString("es-VE");

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: RateHistoryPoint[] };

// Rendered only while the calculator's Drawer/Popover is open (Radix
// unmounts its content on close), so mounting here is naturally "fetch
// only when the owner opens the calculator" with no extra gating —
// getRateHistory() itself caches at module scope so re-opening within the
// same page load doesn't refetch.
export function RateHistoryChart() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getRateHistory()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <div className="h-[160px] w-full animate-pulse rounded-lg bg-muted/40" />;
  }

  if (state.status === "error") {
    return (
      <p className="text-xs text-muted-foreground">No pudimos cargar el histórico de tasas en este momento.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Tasa BCV — últimos 7 días</p>
      <ChartContainer config={chartConfig} className="h-[160px] w-full">
        <LineChart data={state.data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            minTickGap={40}
            tickFormatter={tickFormatter}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            width={44}
            tickFormatter={yAxisFormatter}
          />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={tickFormatter} />} />
          <Line dataKey="usd" type="monotone" stroke="var(--color-usd)" strokeWidth={2} dot={false} />
          <Line dataKey="eur" type="monotone" stroke="var(--color-eur)" strokeWidth={2} dot={false} />
          <ChartLegend content={<ChartLegendContent />} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
