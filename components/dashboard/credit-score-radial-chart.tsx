"use client";

import { Label, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

// Same color families as CREDIT_SCORE_TIER_BADGE_CLASS (lib/types.ts), just
// as raw fill values instead of Tailwind utility classes — recharts needs an
// actual color for the RadialBar's fill, not a class name.
const TIER_COLOR: Record<string, string> = {
  Excelente: "var(--color-emerald-500)",
  Bueno: "var(--color-sky-500)",
  Regular: "var(--color-amber-500)",
  Malo: "var(--color-red-500)",
  "Sin historial": "var(--color-neutral-400)",
};

export function CreditScoreRadialChart({ score, tier }: { score: number; tier: string }) {
  const chartData = [{ tier, score, fill: "var(--color-score)" }];
  const chartConfig = {
    score: { label: "Puntaje", color: TIER_COLOR[tier] ?? TIER_COLOR["Sin historial"] },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={chartConfig} className="mx-auto h-[190px] w-[190px]">
      <RadialBarChart data={chartData} startAngle={0} endAngle={250} innerRadius={80} outerRadius={90}>
        {/* Without an explicit domain, recharts scales the bar's angle
            relative to the data's own max — with a single point that's
            always 100%. Fixing the domain to [0, 1000] is what makes this an
            actual "score out of 1000" gauge instead of an always-full ring. */}
        <PolarAngleAxis type="number" domain={[0, 1000]} angleAxisId={0} tick={false} />
        <PolarGrid
          gridType="circle"
          radialLines={false}
          stroke="none"
          className="first:fill-muted last:fill-background"
          polarRadius={[90, 80]}
        />
        <RadialBar dataKey="score" background cornerRadius={10} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                      {score}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 20} className="fill-muted-foreground text-xs">
                      de 1000
                    </tspan>
                  </text>
                );
              }
            }}
          />
        </PolarRadiusAxis>
      </RadialBarChart>
    </ChartContainer>
  );
}
