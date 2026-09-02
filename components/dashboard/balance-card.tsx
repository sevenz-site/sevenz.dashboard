"use client";

import { useState } from "react";
import { ChartColumn, Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { cn } from "@/lib/utils";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";
import type { LedgerCurrency } from "@/lib/types";

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
