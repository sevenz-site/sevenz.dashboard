"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";

// Wraps WeeklyLendingChart with its own show/hide toggle — a VE owner sees
// two of these side by side (USD, EUR), and each can be hidden
// independently since they're two unrelated ledgers.
export function LendingChartPanel({ data, title }: { data: WeeklyLendingPoint[]; title: string }) {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setVisible(true)}>
        Mostrar {title}
      </Button>
    );
  }

  return (
    <div className="relative min-w-64 flex-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setVisible(false)}
        className="absolute right-1 top-1 h-7 px-2 text-xs text-muted-foreground"
      >
        Ocultar
      </Button>
      <WeeklyLendingChart data={data} title={title} />
    </div>
  );
}
