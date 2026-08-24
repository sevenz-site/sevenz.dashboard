"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MOVEMENT_CURRENCY_OPTIONS,
  convertToAllCurrencies,
  type MovementCurrency,
  type MovementRateContext,
} from "@/lib/exchange-rate/convert";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";

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
    <span className="flex flex-1 items-center gap-2 text-sm tabular-nums">
      $1 = {formatBs(rateContext.effectiveRate.usd)} · €1 = {formatBs(rateContext.effectiveRate.eur)}
      {rateContext.rateMode === "CUSTOM" ? (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          tasa propia
        </Badge>
      ) : null}
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
      <Sheet open={open} onOpenChange={setOpen}>
        <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {rateInfo}
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        </div>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Calculadora rápida</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">{calculator}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 sm:w-auto">
        {rateInfo}
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-80">
        {calculator}
      </PopoverContent>
    </Popover>
  );
}

function RateCalculator({ rate }: { rate: { usd: number; eur: number } }) {
  const [amountStr, setAmountStr] = useState("");
  const [fromCurrency, setFromCurrency] = useState<MovementCurrency>("VES");

  const parsed = Number(amountStr);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  const result = hasAmount ? convertToAllCurrencies(parsed, fromCurrency, rate) : null;

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
          type="number"
          min="0"
          step="0.01"
          placeholder="Monto"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
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
              <dt className="text-muted-foreground">USD</dt>
              <dd className="tabular-nums">{formatDisplayCurrency(result.usd, "USD")}</dd>
            </div>
          ) : null}
          {fromCurrency !== "EUR" ? (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">EUR</dt>
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
