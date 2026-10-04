"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChartColumn, Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { cn } from "@/lib/utils";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
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

// One of the cartera's ledgers: its balance and that same currency's chart.
export type LedgerTotal = {
  balance: number;
  currency: LedgerCurrency | null;
  chartData: WeeklyLendingPoint[];
  chartTitle?: string;
};

// "Capital por cobrar" — ONE card, even when the business runs two currencies.
//
// ──────────────────────────────────────────────────────────────────────
// IT USED TO BE TWO CARDS, AND WHY IT IS ONE NOW
//
// Until 2026-10-03 a Venezuelan business saw two identical cards, USD and Euro,
// side by side. The problem was not the room they took up: it is that they
// asked to be compared. Two figures of the same size, with the same label and
// the same colour, force you to read both to find out what your cartera is —
// and in practice one of them is nearly always marginal (a couple of clients in
// euros against sixty in dollars).
//
// Owner's decision, 2026-10-03: "the larger one big, the smaller one on a small
// line underneath". That way the big figure answers "how much am I owed" by
// itself, and the small one is still there, which is what matters on the day it
// stops being marginal.
//
// WHAT DECIDES WHICH IS LARGER: the screen does, not this card, because the
// screen is what holds both totals. And on a tie — both equal, with zero-zero
// as the normal case for an owner who has just signed up — USD wins. That is
// not an aesthetic preference: in a Venezuelan business the dollar is the main
// ledger, and an owner with no fiado yet has to see the currency they are about
// to work in, not the other one.
//
// THE EYE HIDES BOTH FIGURES. Half a hidden cartera is not a hidden cartera:
// whoever hides the amounts does it because someone is looking at the screen.
export function BalanceCard({
  label,
  main,
  secondary,
  ledger,
}: {
  label: string;
  main: LedgerTotal;
  // `null` for a Colombian business, which has a single ledger.
  secondary?: LedgerTotal | null;
  ledger: LedgerDisplay | null;
}) {
  const [hidden, toggleHidden] = useHiddenBalances();
  // Closed on both server and client. The previous version defaulted to open
  // on desktop via useIsMobile, which resolves only after hydration — as a
  // conditional render rather than a CSS toggle that would mean the server
  // and the browser producing different markup on a phone.
  const [chartOpen, setChartOpen] = useState(false);

  const iconButton =
    "shrink-0 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring";

  // Both ledgers, for the charts. Until "Reportes" exists (delivery 3) this
  // button is the ONLY way to reach them, so it opens both and not just the
  // larger currency's: leaving the euro chart unreachable would be losing a
  // feature along the way of a layout change.
  const ledgers = secondary ? [main, secondary] : [main];

  // The small line. Formatted here rather than with
  // `ExchangeRateBalanceDisplay` because that component renders TWO lines — the
  // figure and its bolívar equivalent below it — and the brief is one.
  const smaller = secondary ? formatLedgerAmount(secondary.balance, secondary.currency, ledger) : null;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <HideableBalance
            balance={main.balance}
            currency={main.currency}
            ledger={ledger}
            showToggle={false}
            mainClassName="text-3xl text-amber-600 dark:text-amber-400"
          />
          {smaller ? (
            <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
              {hidden ? (
                "••••••"
              ) : (
                <>
                  <span className="font-medium text-foreground">{smaller.primary}</span>
                  {smaller.secondary ? ` · ${smaller.secondary} hoy` : null}
                </>
              )}
            </p>
          ) : null}
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
            aria-label={chartOpen ? "Ocultar gráficos" : "Mostrar gráficos"}
            aria-pressed={chartOpen}
            title={chartOpen ? "Ocultar gráficos" : "Mostrar gráficos"}
            className={cn(iconButton, chartOpen ? "text-foreground" : "text-muted-foreground")}
          >
            <ChartColumn className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {chartOpen
        ? ledgers.map((ledger) => (
            <WeeklyLendingChart
              key={ledger.currency ?? "cop"}
              data={ledger.chartData}
              title={ledger.chartTitle}
            />
          ))
        : null}
    </div>
  );
}
