import { CustomRateBadge } from "@/components/exchange-rate-custom-badge";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { cn } from "@/lib/utils";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";

// Shared by the dashboard total, the client-list rows, the client detail
// page and the public client screen. When rateContext is null (a 'CO' owner,
// or a 'VE' owner before any rate has ever been fetched) this renders exactly
// what the app has always shown — no behavior change at all.
//
// For a VE owner the balance passed in is USD (the ledger's canonical unit);
// the bolívar line underneath is today's equivalent and moves with the rate.
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

  const ledger: LedgerDisplay | null = rateContext
    ? { displayCurrency: rateContext.displayCurrency, rate: rateContext.effectiveRate }
    : null;
  const { primary, secondary } = formatLedgerAmount(balance, ledger);

  if (!ledger || !rateContext) {
    return <p className={mainClass}>{primary}</p>;
  }

  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" && "items-end")}>
      <p className={mainClass}>{primary}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{secondary} hoy</p>
      {rateContext.rateMode === "CUSTOM" ? (
        <CustomRateBadge currentBcvUsd={rateContext.officialRate.usd} />
      ) : null}
    </div>
  );
}
