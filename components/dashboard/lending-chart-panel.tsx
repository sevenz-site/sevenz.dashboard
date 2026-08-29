"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import { useIsMobile } from "@/hooks/use-mobile";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";

// Wraps WeeklyLendingChart with its own show/hide toggle — a VE owner sees
// two of these (USD, EUR), each hideable independently since they're two
// unrelated ledgers. The toggle row sits below the chart, full width, same
// label+chevron pattern as the table's "Más filtros"/legend triggers.
//
// Starts closed on mobile (screen real estate is scarcer, the chart isn't
// the first thing worth seeing) and open on desktop — same useIsMobile()
// hook already used for this kind of behavior-not-just-layout decision in
// exchange-rate-strip.tsx, so the threshold matches that, not the sm:
// breakpoint the rest of this page's CSS layout switches at.
export function LendingChartPanel({ data, title }: { data: WeeklyLendingPoint[]; title: string }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(() => !isMobile);

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
