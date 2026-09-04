"use client";

import { Eye, EyeOff } from "lucide-react";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { cn } from "@/lib/utils";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { LedgerCurrency } from "@/lib/types";

// Wraps the dashboard's top "Capital por cobrar" KPI figures (USD, EUR, or
// the single COP one) with a shared show/hide toggle — see
// useHiddenBalances for why it's a single switch across every card rather
// than one per card. Deliberately scoped to just these summary figures,
// not the client table or a client's own detail page.
export function HideableBalance({
  balance,
  currency,
  ledger,
  mainClassName,
  showToggle = true,
}: {
  balance: number;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  mainClassName?: string;
  // BalanceCard renders the eye itself, in a column beside its own chart
  // toggle, so the two controls sit together. State is still shared through
  // useHiddenBalances, so both stay in sync either way.
  showToggle?: boolean;
}) {
  const [hidden, toggle] = useHiddenBalances();

  return (
    <div className="flex items-start justify-between gap-2">
      {hidden ? (
        <div className="flex flex-col gap-0.5">
          <p className={cn("text-2xl font-semibold tabular-nums", mainClassName)}>••••••</p>
          {/* Matches ExchangeRateBalanceDisplay's own condition for the
              secondary "hoy" line — a COP owner (no ledger/currency) never
              has one to mask either. */}
          {ledger && currency ? <p className="text-xs text-muted-foreground tabular-nums">•••••• hoy</p> : null}
        </div>
      ) : (
        <ExchangeRateBalanceDisplay balance={balance} currency={currency} ledger={ledger} mainClassName={mainClassName} />
      )}
      {showToggle ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
          aria-pressed={!hidden}
          className="mt-1 shrink-0 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {hidden ? (
            <Eye className="size-4" aria-hidden="true" />
          ) : (
            <EyeOff className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
