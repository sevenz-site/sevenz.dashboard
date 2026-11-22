"use client";

import { useState } from "react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { usePrecioUsdt } from "@/components/dashboard/use-precio-usdt";
import {
  CalculatorSurface,
  RateCalculator,
  type MonedaCalculadora,
  type SaldoDelCliente,
} from "@/components/exchange-rate-calculator";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { sendPublicEvent } from "@/components/public/public-event";
import { formatBs } from "@/lib/exchange-rate/format";
import type { RateStatus } from "@/lib/exchange-rate/rate-status";

// THE CALCULATOR ON THE CLIENT'S BALANCE LINK. Owner's request of 2026-11-19:
// «clientes mencionan que para poder pagar deben calcular los bolívares que
// pagarán en dólares o euros y desde el enlace no tienen como calcularlo».
//
// Frames `2213:24204`, approved by the owner the same day, with the row as he
// adjusted it in `2213:24244` (white button, 12px text, no arrow) and the «Tu
// saldo» pills removed by him from every frame before this was built. The
// calculator inside is the owner's own (`components/exchange-rate-calculator.tsx`)
// in its client variant, so the two cannot drift apart.
//
// Only mounted for a Venezuelan business with a stored BCV rate: the page
// decides that, and a Colombian link never gets here.

const FLAG_14 = "size-3.5 shrink-0";

export function ClientRateCalculator({
  token,
  rate,
  rateDate,
  rateStatus,
  rateFetchedAt,
  saldo,
}: {
  token: string;
  rate: { usd: number; eur: number };
  rateDate: string | null;
  rateStatus: RateStatus;
  rateFetchedAt: string | null;
  saldo: SaldoDelCliente;
}) {
  // OPENS IN THE BOOK THEY OWE IN: dollars when there is a dollar debt, euros
  // when the debt is only in euros (owner's decision of 2026-11-19). With
  // nothing owed it opens in dollars with an empty field.
  const initialPair: MonedaCalculadora =
    (saldo.USD ?? 0) > 0 ? "USD" : (saldo.EUR ?? 0) > 0 ? "EUR" : "USD";
  const [pair, setPair] = useState<MonedaCalculadora>(initialPair);
  const [open, setOpen] = useState(false);
  // Asked for on opening, not on page load: most visits only read the balance,
  // and they should not pay for a request to Binance's price.
  const { precio: usdt, edadSegundos: edadUsdt } = usePrecioUsdt(open, token);

  // Same guard as the owner's: a USDT tab whose price went away falls back to
  // dollars instead of staying on a tab with no rate.
  if (pair === "USDT" && !usdt) setPair("USD");

  const onOpenChange = (abrir: boolean) => {
    if (abrir) {
      // Each opening starts from their balance again. The calculator remounts
      // with the sheet, so its figure resets; the tab lives here and has to be
      // reset by hand, or a client who left it on USDT would reopen to an
      // empty field instead of what they owe.
      setPair(initialPair);
      sendPublicEvent(token, "balance_calculator_opened", {
        prefilled: (saldo[initialPair as "USD" | "EUR"] ?? 0) > 0 ? initialPair : "none",
      });
    }
    setOpen(abrir);
  };

  return (
    <CalculatorSurface
      open={open}
      onOpenChange={onOpenChange}
      // Frame `2213:24843`: on the web the window opens ABOVE the row, so the
      // balances it is calculating from stay in view. Radix flips it below if
      // there is no room above.
      popoverSide="top"
      // 380 wide with 16px of padding, as frame `2213:24843` measures it.
      popoverClassName="w-[min(380px,calc(100vw-2rem))] p-4"
      popoverTitle
      // THE WHOLE ROW OPENS IT, like the owner's strip, with «Calcular» drawn as
      // a span: a button inside a button is invalid HTML and the inner one stops
      // working. The accessible name comes from the content — both rates, then
      // the action.
      trigger={() => (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border bg-muted px-3.5 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex flex-1 flex-col gap-0.5 text-[13px] font-medium tabular-nums text-foreground">
            <span className="flex items-center gap-1.5">
              <CurrencyFlagIcon currency="USD" className={FLAG_14} />
              $1 = {formatBs(rate.usd)}
            </span>
            <span className="flex items-center gap-1.5">
              <CurrencyFlagIcon currency="EUR" className={FLAG_14} />
              €1 = {formatBs(rate.eur)}
            </span>
          </span>
          <span className="shrink-0 rounded-lg border bg-background px-3 py-2 text-xs text-foreground">
            Calcular
          </span>
        </button>
      )}
    >
      <RateCalculator
        variant="client"
        rate={rate}
        usdt={usdt?.ask ?? null}
        edadUsdt={edadUsdt}
        pair={pair}
        onPairChange={setPair}
        rateDate={rateDate}
        rateStatus={rateStatus}
        rateFetchedAt={rateFetchedAt}
        saldo={saldo}
      />
      <ExchangeRateLegalDisclaimer incluyeUsdt={!!usdt} />
    </CalculatorSurface>
  );
}
