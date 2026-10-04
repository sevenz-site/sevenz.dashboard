"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { LedgerCurrency } from "@/lib/types";

// One of the cartera's ledgers. Just the figure since delivery 3: the charts
// that used to ride along here now live on `/reportes`.
export type LedgerTotal = {
  balance: number;
  currency: LedgerCurrency | null;
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

        {/* Just the eye. The chart toggle sat beside it until delivery 3. */}
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
          aria-pressed={!hidden}
          className="mt-1 shrink-0 rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          {hidden ? (
            <Eye className="size-4" aria-hidden="true" />
          ) : (
            <EyeOff className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* The chart toggle's replacement, not an extra. Moving the charts to
          /reportes left this card with no way out towards them at all, and an
          owner who knew they were here would have gone looking where they no
          longer are. */}
      <Link
        href="/reportes"
        className="self-end text-xs text-muted-foreground underline decoration-1 underline-offset-2 transition-colors hover:text-foreground"
      >
        Ver reportes
      </Link>
    </div>
  );
}
