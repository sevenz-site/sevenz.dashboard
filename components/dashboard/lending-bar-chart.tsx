"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";

// Same red/green convention already used for charge/payment amounts
// elsewhere in the app (e.g. movement-history-list.tsx's text-destructive /
// text-emerald-600), just as chart fill colors instead of text colors.
const chartConfig = {
  fiado: { label: "Fiado", color: "var(--destructive)" },
  abono: { label: "Abono", color: "var(--color-emerald-500)" },
} satisfies ChartConfig;

export function WeeklyLendingChart({
  data,
  title = "Fiado vs. Abono de la semana",
  bare = false,
}: {
  data: WeeklyLendingPoint[];
  title?: string;
  // `bare` drops the chart's own card: no border, no padding, no `flex-1`, and
  // the 212px plot the Figma spec of 2026-10-04 asks for. It is for `/reportes`,
  // where the chart sits INSIDE the ledger's card — left as it was, it would
  // draw a second border inside the first, and its `flex-1` would grow down the
  // card's column instead of across a row.
  bare?: boolean;
}) {
  return (
    <div
      className={
        bare
          ? "flex w-full min-w-0 flex-col gap-2"
          : "flex min-w-64 flex-1 flex-col gap-2 rounded-lg border p-4"
      }
    >
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <ChartContainer config={chartConfig} className={bare ? "h-[212px] w-full" : "h-[180px] w-full"}>
        <BarChart data={data} margin={{ top: 10 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="fiado" fill="var(--color-fiado)" radius={4} />
          <Bar dataKey="abono" fill="var(--color-abono)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
