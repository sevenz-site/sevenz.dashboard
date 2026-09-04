"use client";

import { useState, type ChangeEvent } from "react";
import { ArrowUpDown, Share2 } from "lucide-react";
import dynamic from "next/dynamic";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  convertToAllCurrencies,
  type MovementCurrency,
  type MovementRateContext,
} from "@/lib/exchange-rate/convert";
import { formatBs, formatBsAmount, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { LedgerCurrency } from "@/lib/types";

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
  const { inset: keyboardInset, visibleHeight } = useKeyboardInset();
  // Lifted so the history table's variation column can follow the same choice
  // — the mockup's last column is "Var. USD" or "Var. EUR" depending on which
  // pill is active, not a fixed one.
  const [pair, setPair] = useState<LedgerCurrency>("USD");
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

  const calculator = (
    <RateCalculator
      rate={rateContext.effectiveRate}
      pair={pair}
      onPairChange={setPair}
      fetchedAt={rateContext.rateFetchedAt}
    />
  );
  const trigger = (
    <Button type="button" size="sm" variant="outline">
      Calcular
    </Button>
  );

  if (isMobile) {
    // A Sheet (Radix Dialog) rather than vaul's Drawer. The Drawer positions
    // itself with a JS-driven transform, which fought the on-screen keyboard:
    // opening the calculator with the keyboard up left the sheet's top cut off
    // above the screen, and the only way back was to dismiss the keyboard and
    // refocus the input so the browser repositioned it.
    //
    // Switching primitives is not by itself the fix — a bottom sheet is still
    // `fixed bottom-0`, anchored to a layout viewport that does not shrink for
    // the keyboard. The sizing below is what actually fixes it: bottom is
    // lifted by however much the keyboard covers, and the height is capped to
    // the space actually visible, both measured from visualViewport rather
    // than assumed from vh units.
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {rateInfo}
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        </div>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] rounded-t-xl"
          style={{
            bottom: keyboardInset || undefined,
            maxHeight: visibleHeight ? Math.round(visibleHeight * 0.85) : undefined,
          }}
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Calculadora</SheetTitle>
          </SheetHeader>
          {/* The sheet is capped, so the body is what scrolls — otherwise the
              rate history table simply overflows past the top edge again. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {calculator}
            <RateHistoryTable currency={pair} />
            <ExchangeRateLegalDisclaimer />
          </div>
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
          <RateHistoryTable currency={pair} />
          <ExchangeRateLegalDisclaimer />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RateCalculator({
  rate,
  pair,
  onPairChange,
  fetchedAt,
}: {
  rate: { usd: number; eur: number };
  pair: LedgerCurrency;
  onPairChange: (next: LedgerCurrency) => void;
  fetchedAt?: string | null;
}) {
  // Digits-only "cents" mask — the same way a POS amount field works: typing
  // shifts digits in from the right, the last two are always the decimals.
  const [rawDigits, setRawDigits] = useState("");
  // Which side the owner types into. Starts on bolívares because that is the
  // question a shop actually asks — "this costs Bs. X, what is that in
  // dollars?" — and "Invertir" swaps it.
  const [entry, setEntry] = useState<"VES" | "FOREIGN">("VES");
  const [shared, setShared] = useState(false);

  const pairRate = pair === "USD" ? rate.usd : rate.eur;
  const pairName = pair === "USD" ? "Dólar" : "Euro";
  const pairPlural = pair === "USD" ? "Dólares" : "Euros";

  const cents = Number(rawDigits || "0");
  const amount = cents / 100;
  const hasAmount = amount > 0;

  const fromCurrency: MovementCurrency = entry === "VES" ? "VES" : pair;
  const converted = hasAmount ? convertToAllCurrencies(amount, fromCurrency, rate) : null;
  const result = converted ? (entry === "VES" ? (pair === "USD" ? converted.usd : converted.eur) : converted.ves) : null;

  // Placeholders rather than a prefilled amount: the mockup opens on an empty
  // field, and a prefilled number reads as a value the owner entered.
  // Prefixed, so the field reads the same as its own placeholder and as the
  // result below it. formatBsAmount alone renders a bare "100.000,00", which
  // next to a "Bs. 0,00" placeholder looks like a different kind of number.
  // The digits-only mask strips the prefix on every keystroke and re-adds it,
  // so it never reaches the parsed value.
  const putValue = hasAmount
    ? entry === "VES"
      ? `Bs. ${formatBsAmount(amount)}`
      : formatDisplayCurrency(amount, pair)
    : "";
  const putPlaceholder = entry === "VES" ? "Bs. 0,00" : formatDisplayCurrency(0, pair);
  const getText =
    result === null
      ? entry === "VES"
        ? formatDisplayCurrency(0, pair)
        : formatBs(0)
      : entry === "VES"
        ? formatDisplayCurrency(result, pair)
        : formatBs(result);

  function handleAmountChange(e: ChangeEvent<HTMLInputElement>) {
    setRawDigits(e.target.value.replace(/\D/g, "").slice(0, 15));
  }

  async function handleShare() {
    // With nothing typed there is no conversion to send, but the rate itself is
    // still worth sharing — and it is the thing an owner is most often asked
    // for. Sharing "Bs. 0,00 = $0.00" instead, or disabling the button with no
    // explanation, both waste the tap.
    const text = hasAmount
      ? `${putValue} = ${getText}${entry === "VES" ? ` ${pairPlural}` : ""} · ${stampLabel}`
      : `1 ${pairName} = ${formatBs(pairRate)} · ${stampLabel}`;
    try {
      // The native sheet is what gets this into WhatsApp, which is where these
      // quotes actually go. Clipboard is the fallback for desktop, where
      // navigator.share often does not exist.
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      // A dismissed share sheet rejects; that is a normal outcome, not an error.
    }
  }

  const stampLabel = `Tasa BCV del ${formatRateStamp(fetchedAt)}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Which pair, not which source currency. Converting dollars straight to
          euros is gone with the old three-way select: a shop converts one
          foreign currency against bolívares, never one against the other. */}
      <div className="flex gap-2">
        {(["USD", "EUR"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPairChange(c)}
            aria-pressed={pair === c}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
              pair === c
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground",
            )}
          >
            <CurrencyFlagIcon currency={c} />
            {c === "USD" ? "Dólares" : "Euro"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
        <label htmlFor="calc-amount" className="text-xs text-muted-foreground">
          Tú pones
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="calc-amount"
            type="text"
            inputMode="numeric"
            placeholder={putPlaceholder}
            value={putValue}
            onChange={handleAmountChange}
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
          />
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {entry === "VES" ? "Bolívares" : pairPlural}
            <CurrencyFlagIcon currency={entry === "VES" ? "VES" : pair} />
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Carry the result across rather than only flipping the labels.
            // Keeping the digits would turn "Bs. 100.000" into "€100.000" —
            // the same number meaning something a thousand times larger, with
            // nothing on screen to say so. Swapping the value keeps the
            // equivalence the owner was just looking at.
            if (result !== null) setRawDigits(String(Math.round(result * 100)));
            setEntry((e) => (e === "VES" ? "FOREIGN" : "VES"));
          }}
        >
          <ArrowUpDown className="size-4" />
          Invertir
        </Button>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          1 {pairName} = {formatBs(pairRate)}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 rounded-lg bg-primary px-3 py-2 text-primary-foreground">
        <span className="text-xs opacity-70">Tú cobras</span>
        <span className="text-2xl font-semibold tabular-nums">
          {getText}
          {entry === "VES" ? ` ${pairPlural}` : ""}
        </span>
        <span className="text-xs opacity-70">{stampLabel}</span>
      </div>

      <Button type="button" variant="outline" onClick={handleShare}>
        {shared ? "Copiado" : "Compartir"}
        <Share2 className="size-4" />
      </Button>
    </div>
  );
}

// "4 sept. - 3:14 p. m." in the owner's own timezone. Vercel runs in UTC, so
// formatting without naming a zone would stamp a Venezuelan owner's rate four
// hours ahead of when they actually saw it.
function formatRateStamp(iso?: string | null): string {
  if (!iso) return "hoy";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "hoy";
  const date = new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    timeZone: "America/Caracas",
  }).format(d);
  const time = new Intl.DateTimeFormat("es-VE", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  }).format(d);
  return `${date} - ${time}`;
}
