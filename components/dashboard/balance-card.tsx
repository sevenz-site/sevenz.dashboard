"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChartColumn, Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { cn } from "@/lib/utils";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";
import type { LedgerCurrency } from "@/lib/types";

// The charting library is 368 KB — the second largest thing the app ships —
// and this chart starts closed, so most owners never see it. Loading it on
// demand keeps that weight off every Cartera load instead of spending it on
// a phone that may never open a chart. Same pattern the rate calculator's
// history table already uses.
//
// The placeholder mirrors the real chart's box rather than declaring a height
// of its own, so opening a chart on a phone doesn't shove the rest of the page
// down and then yank it back once the library arrives. It has to be built from
// the same parts — same outer classes, a title-sized line, a 180px plot area —
// because a plain height on this box does nothing: flex-1 in the card's column
// resolves to flex-basis 0 and wins over it. An earlier version set
// style={{height: 250}} and still collapsed to 41px, jumping 208px at 375px
// wide the moment recharts landed.
const WeeklyLendingChart = dynamic(
  () => import("@/components/dashboard/lending-bar-chart").then((m) => m.WeeklyLendingChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-w-64 flex-1 flex-col gap-2 rounded-lg border p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[180px] w-full animate-pulse rounded bg-muted/50" />
      </div>
    ),
  },
);

// One "Capital por cobrar" figure as an outlined card, matching the rate
// calculator's card so the whole section reads as one family. Both controls
// live in a column on the right: the shared show/hide-amounts eye, and this
// card's own chart toggle.
//
// The eye is rendered here rather than inside HideableBalance so the two
// buttons sit together in one column. They still share state through
// useHiddenBalances, which is a single switch across every card by design.
export function BalanceCard({
  label,
  balance,
  currency,
  ledger,
  chartData,
  chartTitle,
}: {
  label: string;
  balance: number;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  chartData: WeeklyLendingPoint[];
  chartTitle?: string;
}) {
  const [hidden, toggleHidden] = useHiddenBalances();
  // Closed on both server and client. The previous version defaulted to open
  // on desktop via useIsMobile, which resolves only after hydration — as a
  // conditional render rather than a CSS toggle that would mean the server
  // and the browser producing different markup on a phone.
  const [chartOpen, setChartOpen] = useState(false);

  const iconButton =
    "shrink-0 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <HideableBalance
            balance={balance}
            currency={currency}
            ledger={ledger}
            showToggle={false}
            mainClassName="text-3xl text-amber-600 dark:text-amber-400"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Lo que tus clientes te deben en total, sin descontar nada.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 pt-1">
          <button
            type="button"
            onClick={toggleHidden}
            aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
            aria-pressed={!hidden}
            className={cn(iconButton, "text-muted-foreground")}
          >
            {hidden ? (
              <Eye className="size-4" aria-hidden="true" />
            ) : (
              <EyeOff className="size-4" aria-hidden="true" />
            )}
          </button>

          {/* lucide has no crossed-out chart icon, so the state is carried by
              colour and aria-pressed rather than by a second glyph — the same
              information, without inventing an icon that doesn't exist. */}
          <button
            type="button"
            onClick={() => setChartOpen((open) => !open)}
            aria-label={chartOpen ? `Ocultar ${chartTitle ?? "gráfico"}` : `Mostrar ${chartTitle ?? "gráfico"}`}
            aria-pressed={chartOpen}
            title={chartOpen ? "Ocultar gráfico" : "Mostrar gráfico"}
            className={cn(iconButton, chartOpen ? "text-foreground" : "text-muted-foreground")}
          >
            <ChartColumn className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {chartOpen ? <WeeklyLendingChart data={chartData} title={chartTitle} /> : null}
    </div>
  );
}
