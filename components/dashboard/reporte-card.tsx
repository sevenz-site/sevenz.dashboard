"use client";

import dynamic from "next/dynamic";
import { Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";
import type { LedgerCurrency } from "@/lib/types";

// `ssr: false` keeps recharts off the server render, where `ResponsiveContainer`
// has no width to measure and draws nothing anyway. The placeholder mirrors the
// real box so the page does not shove itself around when the library lands.
const WeeklyLendingChart = dynamic(
  () => import("@/components/dashboard/lending-bar-chart").then((m) => m.WeeklyLendingChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-2">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[212px] w-full animate-pulse rounded bg-muted/50" />
      </div>
    ),
  },
);

// ONE CARD PER LEDGER on `/reportes`: the currency's capital on top and its own
// chart underneath. From the Figma spec of 2026-10-04 (frame `1074:30167`).
//
// The screen used to be two bare charts. Putting the figure on the same card is
// what makes the chart mean something: "fiaste 300 esta semana" reads very
// differently next to "te deben 4.000" than on its own.
//
// It is NOT `BalanceCard`. That one lives on Inicio, holds both ledgers in one
// card — the larger big, the smaller on a line below — and carries the link
// here. This one is per ledger and carries a chart. Sharing a component between
// them would mean a prop for every difference.
export function ReporteCard({
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
  chartTitle: string;
}) {
  const [hidden, toggleHidden] = useHiddenBalances();

  return (
    <div className="flex w-full flex-col gap-4 rounded-[10px] border px-4 py-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-foreground">{label}</p>
          {/* 30px and `--money-due`, same as Inicio's card. The size is what
              makes the colour legal: WCAG drops the floor to 3:1 from 24px up,
              and this orange clears it at 3,36:1 and not at normal text size. */}
          <HideableBalance
            balance={balance}
            currency={currency}
            ledger={ledger}
            showToggle={false}
            mainClassName="text-[30px] leading-tight text-money-due"
          />
        </div>
        {/* The same single switch as Inicio (`useHiddenBalances`): hiding the
            amounts on one screen hides them on the other, because the reason to
            hide them — someone is looking — does not stop at a route. */}
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
          aria-pressed={!hidden}
          className="shrink-0 rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          {hidden ? (
            <Eye className="size-6" aria-hidden="true" />
          ) : (
            <EyeOff className="size-6" aria-hidden="true" />
          )}
        </button>
      </div>

      <WeeklyLendingChart data={chartData} title={chartTitle} bare />
    </div>
  );
}
