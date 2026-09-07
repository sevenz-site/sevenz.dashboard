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
      rateDate={rateContext.rateDate}
      rateStatus={rateContext.rateStatus}
      rateFetchedAt={rateContext.rateFetchedAt}
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
  rateDate,
  rateStatus,
  rateFetchedAt,
}: {
  rate: { usd: number; eur: number };
  pair: LedgerCurrency;
  onPairChange: (next: LedgerCurrency) => void;
  rateDate?: string | null;
  rateStatus?: "current" | "no_publication" | "unconfirmed";
  rateFetchedAt?: string | null;
}) {
  // Digits-only "cents" mask — the same way a POS amount field works: typing
  // shifts digits in from the right, the last two are always the decimals.
  //
  // Seeded at 1.00 with the foreign currency on top, matching sevenz.site's
  // calculator. This reverses the original "start in bolívares" reasoning: it
  // was right when the field opened empty, because the shop's own question is
  // "esto cuesta Bs. X, ¿cuánto es en dólares?" — but a seeded example answers
  // "¿a cómo está el dólar?" in one glance, and Invertir is one tap away.
  const [rawDigits, setRawDigits] = useState("100");
  // Which currency sits in the TOP field. FOREIGN means the pair (USD/EUR) is
  // on top and bolívares below.
  const [entry, setEntry] = useState<"VES" | "FOREIGN">("FOREIGN");
  // Which of the two fields holds the number actually typed. Both are editable,
  // so this is what keeps the conversion from feeding on its own output: typing
  // 5 in the bolívares field must mean five bolívares, not "convert 5 up, round
  // it, then convert that back down".
  const [source, setSource] = useState<"put" | "get">("put");
  // True until the first edit. The seeded 1.00 is an example, not something the
  // owner entered, so the first tap clears it — otherwise the digits mask would
  // push a typed 5 onto the existing 1.00 and produce $10.05. Only the
  // untouched seed clears: once they have typed, tapping away and back keeps
  // their number.
  const [pristine, setPristine] = useState(true);
  const [shared, setShared] = useState(false);

  const pairRate = pair === "USD" ? rate.usd : rate.eur;
  const pairName = pair === "USD" ? "Dólar" : "Euro";

  const putCurrency: MovementCurrency = entry === "VES" ? "VES" : pair;
  const getCurrency: MovementCurrency = entry === "VES" ? pair : "VES";
  const labelFor = (c: MovementCurrency) =>
    c === "VES" ? "Bolívares" : c === "USD" ? "Dólares" : "Euros";

  const cents = Number(rawDigits || "0");
  const typed = cents / 100;
  const hasAmount = typed > 0;

  const convertBetween = (amount: number, from: MovementCurrency, to: MovementCurrency) => {
    const all = convertToAllCurrencies(amount, from, rate);
    return to === "VES" ? all.ves : to === "USD" ? all.usd : all.eur;
  };
  const putAmount = source === "put" ? typed : convertBetween(typed, getCurrency, putCurrency);
  const getAmount = source === "get" ? typed : convertBetween(typed, putCurrency, getCurrency);

  const money = (amount: number, currency: MovementCurrency) =>
    currency === "VES" ? `Bs. ${formatBsAmount(amount)}` : formatDisplayCurrency(amount, currency);

  // An empty field stays empty rather than snapping back to 0,00 — the owner is
  // mid-edit and a number reappearing under the cursor is its own bug.
  const putValue = rawDigits === "" && source === "put" ? "" : money(putAmount, putCurrency);
  const getValue = rawDigits === "" && source === "get" ? "" : money(getAmount, getCurrency);
  const putPlaceholder = money(0, putCurrency);
  const getPlaceholder = money(0, getCurrency);

  const stampLabel = rateDate ? `Tasa BCV del ${formatRateDate(rateDate)}` : "Tasa BCV";
  // Only when the rate is not today's. Two causes, two sentences, because
  // telling an owner "the BCV doesn't publish on weekends" while the real
  // problem is our own fetch would hide the failure precisely when it costs
  // money — they would price a fiado against a rate they think is confirmed.
  const stampNote =
    rateStatus === "no_publication"
      ? "El BCV no publica sábados, domingos ni festivos. Esta es la última tasa publicada."
      : rateStatus === "unconfirmed"
        ? // A fact, not a status. "Estamos reintentando" read like a spinner —
          // it asked the owner to wait for something that may never change, and
          // still did not tell them the one thing they needed: when this number
          // was last checked. Safe to show fetch time here precisely because
          // the sentence says it is the fetch time.
          `Última actualización: ${formatFetchStamp(rateFetchedAt)}`
        : null;

  function editHandler(field: "put" | "get") {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setSource(field);
      setPristine(false);
      setRawDigits(e.target.value.replace(/[^0-9]/g, "").slice(0, 15));
    };
  }

  // Focus only ever clears the seeded example. It deliberately does NOT change
  // which field is authoritative — typing does that.
  //
  // Making focus set `source` looked equivalent and was not: with Bs. 0,50 in
  // the bottom card, merely tapping the top field reinterpreted those same
  // digits as dollars and the card jumped to Bs. 406,87. Tapping a field is not
  // a statement about what the number means, and a converter that changes its
  // answer because you looked at it is worse than one that is hard to use.
  function focusHandler(field: "put" | "get") {
    return () => {
      if (!pristine) return;
      setSource(field);
      setRawDigits("");
      setPristine(false);
    };
  }

  async function handleShare() {
    // With nothing typed there is no conversion to send, but the rate itself is
    // still worth sharing — and it is the thing an owner is most often asked
    // for. Sharing "Bs. 0,00 = $0.00" instead, or disabling the button with no
    // explanation, both waste the tap.
    const text = hasAmount
      ? `${money(putAmount, putCurrency)} ${labelFor(putCurrency)} = ${money(getAmount, getCurrency)} ${labelFor(getCurrency)} · ${stampLabel}`
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
        <label htmlFor="calc-put" className="text-xs text-muted-foreground">
          Tú pones
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="calc-put"
            type="text"
            inputMode="numeric"
            placeholder={putPlaceholder}
            value={putValue}
            onChange={editHandler("put")}
            onFocus={focusHandler("put")}
            // md:text-2xl no es redundante. El Input de shadcn trae md:text-sm
            // en su clase base, tailwind-merge no lo quita porque es otro
            // grupo de variante, y Tailwind emite las responsive DESPUÉS de
            // las utilidades base — así que desde 768px ganaba y el monto se
            // renderizaba a 14px, el texto MÁS PEQUEÑO de la tarjeta. En móvil
            // siempre midió 24, que es por lo que pasó desapercibido desde que
            // se escribió esta calculadora.
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
          />
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {labelFor(putCurrency)}
            <CurrencyFlagIcon currency={putCurrency} />
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Carry the equivalence across rather than only flipping the
            // labels. Keeping the digits would turn "Bs. 100.000" into
            // "€100.000" — the same number meaning something a thousand times
            // larger, with nothing on screen to say so.
            setRawDigits(String(Math.round(getAmount * 100)));
            setSource("put");
            setPristine(false);
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

      {/* Editable too, in both directions: typing here sets the equivalent
          above. The card names its currency and shows its flag, so it reads the
          same whichever way round it is — before this, bolívares showed a bare
          "Bs. 813,74" while dollars showed "$1.00 Dólares". */}
      <div className="flex flex-col gap-0.5 rounded-lg bg-primary px-3 py-2 text-primary-foreground">
        <label htmlFor="calc-get" className="text-xs opacity-70">
          Tú cobras
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="calc-get"
            type="text"
            inputMode="numeric"
            placeholder={getPlaceholder}
            value={getValue}
            onChange={editHandler("get")}
            onFocus={focusHandler("get")}
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold tabular-nums shadow-none placeholder:text-primary-foreground/50 focus-visible:ring-0 md:text-2xl"
          />
          {/* Label y bandera juntos a la derecha, igual que en "Tú pones".
              Estuvieron separados un rato — label pegado al monto, bandera al
              borde — lo que exigía un input dimensionado con size para que
              abrazara su texto, y truncaba el label a 375px. Agruparlos hace
              que las dos tarjetas se lean igual y elimina todo ese truco. */}
          <span className="flex shrink-0 items-center gap-1.5 text-xs opacity-70">
            {labelFor(getCurrency)}
            <CurrencyFlagIcon currency={getCurrency} />
          </span>
        </div>
        <span className="text-xs opacity-70">{stampLabel}</span>
        {stampNote ? <span className="text-xs opacity-70">{stampNote}</span> : null}
      </div>

      <Button type="button" variant="outline" onClick={handleShare}>
        {shared ? "Copiado" : "Compartir"}
        <Share2 className="size-4" />
      </Button>
    </div>
  );
}


const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "2026-09-04" -> "4 sep 2026", the same shape the 90-day table right below
// prints, because the whole point of this stamp is that the two agree.
//
// Split on the string, never parsed into a Date. The value is already a
// Venezuelan calendar day with no time in it; handing it to `new Date()` reads
// it as UTC midnight and renders the day before for anyone west of Greenwich.
// The previous version formatted a real timestamp and had to name
// America/Caracas for that reason — with a plain date there is no instant to
// place in a zone, so the safe move is not to try.
// "7 sep 2026, 11:36 a. m." in Venezuela. This one IS a real instant, so it
// has to name a zone: Vercel runs in UTC and would report a rate stored at
// 11:36 p.m. Caracas as 3:36 a.m. the next day.
function formatFetchStamp(iso?: string | null): string {
  if (!iso) return "desconocida";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "desconocida";
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  }).format(d);
}

function formatRateDate(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}
