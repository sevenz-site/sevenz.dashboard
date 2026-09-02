"use client";

import { useState, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  MOVEMENT_CURRENCY_OPTIONS,
  convertToAllCurrencies,
  type MovementCurrency,
  type MovementRateContext,
} from "@/lib/exchange-rate/convert";
import { formatBs, formatBsAmount, formatDisplayCurrency } from "@/lib/exchange-rate/format";

// react-day-picker weighs ~19 KB gzipped and only matters once someone opens
// this panel and asks to filter by date. Loading it lazily keeps it out of the
// dashboard's initial download entirely — an owner who only ever registers
// fiados never pays for it. ssr:false because the calendar is client-only and
// there is nothing useful to render for it on the server.
const RateHistoryTable = dynamic(
  () => import("@/components/dashboard/rate-history-table").then((m) => m.RateHistoryTable),
  { ssr: false, loading: () => <div className="h-[260px] w-full animate-pulse rounded-lg bg-muted/40" /> },
);

// Always-visible compact strip on the owner's dashboard (7.3 in the design
// doc). Expands to a mini-calculator on tap — pure client-side arithmetic,
// no client selected, no movement created, nothing persisted. Reuses the
// same convertToAllCurrencies() the movement form's live preview is built
// from, not a second copy of the math.
export function ExchangeRateStrip({ rateContext }: { rateContext: MovementRateContext }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // The rate figures are plain display text — only the "Calcular" button
  // opens the calculator, so it's unambiguous what's tappable.
  const rateInfo = (
    <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
      <span className="flex items-center gap-1.5">
        <CurrencyFlagIcon currency="USD" />
        $1 = {formatBs(rateContext.effectiveRate.usd)}
      </span>
      <span className="flex items-center gap-1.5">
        <CurrencyFlagIcon currency="EUR" />
        €1 = {formatBs(rateContext.effectiveRate.eur)}
      </span>
    </span>
  );

  const calculator = <RateCalculator rate={rateContext.effectiveRate} />;
  const trigger = (
    <Button type="button" size="sm" variant="outline">
      Calcular
    </Button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen} direction="bottom">
        <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {rateInfo}
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        </div>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Calculadora rápida</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {calculator}
            <RateHistoryTable />
            <ExchangeRateLegalDisclaimer />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 sm:w-auto">
        {rateInfo}
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      </div>
      {/* The 90-day table made this panel taller than the screen, so Radix
          pushed it up to fit and the calculator's own inputs ended up above the
          top edge — reachable by nobody. Radix publishes how much room it
          actually has as --radix-popover-content-available-height; bounding the
          panel to that and letting it scroll keeps the calculator at the top
          where it belongs. collisionPadding keeps it off the viewport edge. */}
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto"
      >
        <div className="flex flex-col gap-4">
          {calculator}
          <RateHistoryTable />
          <ExchangeRateLegalDisclaimer />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RateCalculator({ rate }: { rate: { usd: number; eur: number } }) {
  // Digits-only "cents" mask — the same way a POS amount field works: typing
  // shifts digits in from the right, the last two are always the decimals.
  // Opens prefilled with 1 USD's Bs equivalence instead of empty, so there's
  // always a result to look at right away.
  const [rawDigits, setRawDigits] = useState(() => String(Math.max(0, Math.round(rate.usd * 100))));
  const [fromCurrency, setFromCurrency] = useState<MovementCurrency>("VES");

  const cents = Number(rawDigits || "0");
  const parsed = cents / 100;
  const displayValue = formatBsAmount(parsed);
  const hasAmount = parsed > 0;
  const result = hasAmount ? convertToAllCurrencies(parsed, fromCurrency, rate) : null;

  function handleAmountChange(e: ChangeEvent<HTMLInputElement>) {
    setRawDigits(e.target.value.replace(/\D/g, "").slice(0, 15));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Select value={fromCurrency} onValueChange={(v) => setFromCurrency(v as MovementCurrency)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOVEMENT_CURRENCY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="text"
          inputMode="numeric"
          placeholder="Monto"
          value={displayValue}
          onChange={handleAmountChange}
          autoFocus
        />
      </div>
      {result ? (
        <dl className="flex flex-col gap-1 text-sm">
          {fromCurrency !== "VES" ? (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Bs</dt>
              <dd className="tabular-nums">{formatBs(result.ves)}</dd>
            </div>
          ) : null}
          {fromCurrency !== "USD" ? (
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <CurrencyFlagIcon currency="USD" /> USD
              </dt>
              <dd className="tabular-nums">{formatDisplayCurrency(result.usd, "USD")}</dd>
            </div>
          ) : null}
          {fromCurrency !== "EUR" ? (
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <CurrencyFlagIcon currency="EUR" /> EUR
              </dt>
              <dd className="tabular-nums">{formatDisplayCurrency(result.eur, "EUR")}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          Cálculo rápido — no crea ningún movimiento ni requiere elegir un cliente.
        </p>
      )}
    </div>
  );
}
