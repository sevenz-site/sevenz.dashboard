"use client";

import Link from "next/link";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import {
  formatLedgerAmount,
  ledgerLabel,
  type LedgerDisplay,
} from "@/lib/exchange-rate/movement-display";
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
    // Figma spec, 2026-10-04: 1px border, radius 10, padding 8 over 16, and no
    // fill of its own — it used to carry `bg-muted/30`, which on the near-white
    // page read as a second surface the design does not have.
    <div className="flex w-full items-stretch justify-between gap-4 rounded-[10px] border px-4 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-foreground">{label}</p>
        {/* 30px and `--money-due`. The size matters twice over: it is what the
            spec asks for, and it is what makes the colour legal — WCAG calls
            anything from 24px "large text" and drops its floor to 3:1, which
            this orange clears at 3,36:1. Shrink this figure below 24px and the
            colour stops complying without changing. */}
        {/* LA BANDERA VA PEGADA A LA CIFRA, no al rótulo. El rótulo ya nombra
            la moneda con todas sus letras; la bandera es para quien baraja
            dos libros y reconoce antes el icono que la palabra. Solo cuando
            hay moneda: un dueño colombiano tiene un libro, su rótulo no
            nombra ninguna, y no existe bandera que poner. */}
        <HideableBalance
          balance={main.balance}
          currency={main.currency}
          ledger={ledger}
          showToggle={false}
          mainClassName="text-[30px] leading-tight text-money-due"
          leading={
            main.currency ? (
              <CurrencyFlagIcon currency={main.currency} className="size-6 shrink-0" />
            ) : null
          }
        />
        {/* LA LÍNEA PEQUEÑA DICE DE QUÉ MONEDA ES, desde el 2026-10-08.
            `truncate` y no envolver, a 375px: con el rótulo delante, la cifra
            y su equivalente en bolívares no caben en un renglón, y partiendo
            en dos se come una línea de alto y empuja "Ver todo" fuera de su
            esquina. El spec anotado del dueño la dibuja cortada con puntos
            suspensivos, así que el bolívar es lo que cede. La cifra en euros
            —la que importa— entra entera antes del corte.
            Antes era una cifra suelta —"€35.00"— debajo de un rótulo que
            nombra la OTRA moneda, así que la única pista de a qué libro
            pertenecía era el símbolo. Para un dueño venezolano que maneja los
            dos, leer "$" arriba y "€" abajo sin más obliga a deducirlo; y el
            símbolo es justo lo que se parece entre monedas. */}
        {smaller && secondary ? (
          <p className="truncate text-sm tabular-nums text-muted-foreground">
            {ledgerLabel(secondary.currency)}:{" "}
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
      </div>

      {/* The spec's "Icons Container": eye pinned to the top, the link pinned to
          the bottom, both right-aligned. `justify-between` and not a gap, so
          the two stay on the card's own edges however tall the figures make it
          — one currency or two. */}
      <div className="flex shrink-0 flex-col items-end justify-between py-1">
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
          aria-pressed={!hidden}
          className="rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          {hidden ? (
            <Eye className="size-6" aria-hidden="true" />
          ) : (
            <EyeOff className="size-6" aria-hidden="true" />
          )}
        </button>

        {/* The chart toggle's replacement, not an extra. Moving the charts to
            /reportes left this card with no way out towards them at all, and an
            owner who knew they were here would have gone looking where they no
            longer are.

            It says "Ver todo" and not "Ver reportes" since the owner's call of
            2026-10-08, matching the link above the client list. The
            destination is still /reportes; what changed is that both "see the
            rest of this" links on the screen now read the same, instead of one
            naming the section it opens and the other naming the action. */}
        <Link
          href="/reportes"
          className="flex items-center gap-0.5 whitespace-nowrap text-xs text-foreground transition-colors hover:text-money-due"
        >
          Ver todo
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
