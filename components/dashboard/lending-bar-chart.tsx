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
}: {
  data: WeeklyLendingPoint[];
  title?: string;
}) {
  return (
    <div className="flex min-w-64 flex-1 flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
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
