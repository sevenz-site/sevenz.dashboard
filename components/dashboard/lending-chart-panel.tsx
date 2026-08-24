"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";

// Wraps WeeklyLendingChart with its own show/hide toggle — a VE owner sees
// two of these (USD, EUR), each hideable independently since they're two
// unrelated ledgers. The toggle row sits below the chart, full width, same
// label+chevron pattern as the table's "Más filtros"/legend triggers.
export function LendingChartPanel({ data, title }: { data: WeeklyLendingPoint[]; title: string }) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex w-full flex-col gap-2">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium text-muted-foreground">
        {open ? `Ocultar ${title}` : `Mostrar ${title}`}
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <WeeklyLendingChart data={data} title={title} />
      </CollapsibleContent>
    </Collapsible>
  );
}
