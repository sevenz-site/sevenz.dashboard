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
  // GREEN AGAIN SINCE 2026-10-21, and it is the second time this colour
  // changes by the owner's decision. On 2026-10-18 he moved the abono to blue
  // and gave green to the cash sales; on 2026-10-21 he asked for green back
  // —«como estaba anteriormente en toda la app»— and, asked what should
  // happen to the cash sales, chose to let both share it: an abono and a cash
  // sale are both money coming IN, against the fiado's red. They are told
  // apart by their label, not by their colour.
  //
  // `emerald-700` AND NOT THE OLD `emerald-600`. That one measured 3,65:1
  // against white and `DESIGN-SYSTEM.md` asks for 4,5:1 — so the original
  // green had been failing contrast the whole time it was in use, and going
  // back to it verbatim would reintroduce a defect nobody had noticed. The
  // 700 gives 5,36:1 and is what the cash rows already use.
  abono: { label: "Abono", color: "var(--color-emerald-700)" },
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
