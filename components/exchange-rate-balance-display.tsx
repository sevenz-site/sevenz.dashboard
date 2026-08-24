import { formatCurrency } from "@/lib/format";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { bsToDisplay } from "@/lib/exchange-rate/convert";
import { CustomRateBadge } from "@/components/exchange-rate-custom-badge";
import { cn } from "@/lib/utils";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";

// Shared by the dashboard total, the client-list rows, the client detail
// page, and (a JSON-shaped equivalent of) the public client screen. When
// rateContext is null (a 'CO' owner, or a 'VE' owner before any rate has
// ever been fetched) this renders exactly what the app has always shown —
// no behavior change at all.
export function ExchangeRateBalanceDisplay({
  balance,
  rateContext,
  size = "lg",
  mainClassName,
  align = "start",
}: {
  balance: number;
  rateContext: OwnerRateContext | null;
  size?: "lg" | "sm";
  // Lets a caller with its own established styling (e.g. the dashboard's
  // amber text-3xl KPI figure) keep it, instead of the default here.
  mainClassName?: string;
  // The client detail page's desktop layout right-aligns this whole block.
  align?: "start" | "end";
}) {
  const mainClass = cn(
    size === "lg" ? "text-2xl font-semibold tabular-nums" : "text-lg font-semibold tabular-nums",
    mainClassName,
  );

  if (!rateContext) {
    return <p className={mainClass}>{formatCurrency(balance)}</p>;
  }

  const displayAmount = bsToDisplay(balance, rateContext.displayCurrency, rateContext.effectiveRate);

  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" && "items-end")}>
      <p className={mainClass}>{formatDisplayCurrency(displayAmount, rateContext.displayCurrency)}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{formatBs(balance)} (BCV)</p>
      {rateContext.rateMode === "CUSTOM" ? (
        <CustomRateBadge currentBcvUsd={rateContext.officialRate.usd} />
      ) : null}
    </div>
  );
}
