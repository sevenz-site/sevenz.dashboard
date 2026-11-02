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
import type { TrendPoint, TxTrendPoint } from "@/lib/admin/metrics";

// THE SAME COLOURS AS THE CHART IN REPORTES (`reportes-facturacion.tsx`),
// so a colour means the same thing on the owner's screen and here: contado
// green (`--money-in`), abono sky, fiado red. Since 2026-11-02, when the owner
// asked for the third bar («"Fiados", "Abonos" y "De contado"»), abonos are no
// longer emerald -- next to a green contado bar the two would read as one.
// Counts, not money: see `getTransactionTrend`.
const activityConfig = {
  fiado: { label: "Fiados", color: "var(--destructive)" },
  abono: { label: "Abonos", color: "var(--color-sky-600)" },
  contado: { label: "De contado", color: "var(--money-in)" },
} satisfies ChartConfig;

const growthConfig = {
  clients_created: { label: "Clientes nuevos", color: "var(--color-sky-500)" },
} satisfies ChartConfig;

// THE YEAR IS ALWAYS PRINTED -- the owner's request of 2026-10-31. Day and
// week labels used to read «26 ago.» with no year, and notebook-photo fiados
// carry their notebook's date (some from 2024), so «26 ago.» next to «20 jul.»
// looked like an axis out of order when it was 2024 next to 2026. Two digits
// for day and week to keep the ticks short; the month bucket keeps all four.
function formatBucket(iso: string, bucket: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-VE", {
    day: bucket === "month" ? undefined : "numeric",
    month: "short",
    year: bucket === "month" ? "numeric" : "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export function MetricCharts({
  trend,
  txTrend,
  bucket,
}: {
  trend: TrendPoint[];
  txTrend: TxTrendPoint[];
  bucket: string;
}) {
  const data = trend.map((p) => ({ ...p, label: formatBucket(p.bucket, bucket) }));
  const activity = txTrend.map((p) => ({ ...p, label: formatBucket(p.bucket, bucket) }));

  if (data.length === 0 && activity.length === 0) {
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
        <p className="text-sm font-medium">Actividad — fiados, abonos y de contado</p>
        <ChartContainer config={activityConfig} className="h-[220px] w-full">
          <BarChart data={activity} margin={{ top: 10 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="fiado" fill="var(--color-fiado)" radius={4} />
            <Bar dataKey="abono" fill="var(--color-abono)" radius={4} />
            <Bar dataKey="contado" fill="var(--color-contado)" radius={4} />
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
