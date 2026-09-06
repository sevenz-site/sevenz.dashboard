"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { TrendPoint } from "@/lib/admin/metrics";

// Same red/green convention the rest of the app uses for charge/payment, so a
// colour means the same thing here as it does on an owner's own screen.
const activityConfig = {
  charges: { label: "Fiados", color: "var(--destructive)" },
  payments: { label: "Abonos", color: "var(--color-emerald-500)" },
} satisfies ChartConfig;

const growthConfig = {
  clients_created: { label: "Clientes nuevos", color: "var(--color-sky-500)" },
} satisfies ChartConfig;

function formatBucket(iso: string, bucket: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-VE", {
    day: bucket === "month" ? undefined : "numeric",
    month: "short",
    year: bucket === "month" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(d);
}

export function MetricCharts({ trend, bucket }: { trend: TrendPoint[]; bucket: string }) {
  const data = trend.map((p) => ({ ...p, label: formatBucket(p.bucket, bucket) }));

  if (data.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        No hay actividad en este rango.
      </p>
    );
  }

  // min-w-0 on the cards is load-bearing, not tidying. A grid item defaults to
  // min-width:auto, so Recharts' SVG widens the track instead of being
  // constrained by it, and at 375px that pushed the whole page 66px wider than
  // the viewport — a sideways scroll on every phone.
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
        <p className="text-sm font-medium">Actividad — fiados vs abonos</p>
        <ChartContainer config={activityConfig} className="h-[220px] w-full">
          <BarChart data={data} margin={{ top: 10 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="charges" fill="var(--color-charges)" radius={4} />
            <Bar dataKey="payments" fill="var(--color-payments)" radius={4} />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
        <p className="text-sm font-medium">Crecimiento — clientes nuevos</p>
        <ChartContainer config={growthConfig} className="h-[220px] w-full">
          <LineChart data={data} margin={{ top: 10 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="clients_created"
              type="monotone"
              stroke="var(--color-clients_created)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}
