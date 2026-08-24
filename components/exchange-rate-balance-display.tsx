import { CustomRateBadge } from "@/components/exchange-rate-custom-badge";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { cn } from "@/lib/utils";
import type { ExchangeRateMode, LedgerCurrency } from "@/lib/types";

// Renders ONE currency's balance — USD and EUR are independent debts shown
// as separate blocks/columns by every caller (dashboard KPI cards, client
// table columns, client detail, public client screen), never combined into
// one figure. When currency/ledger is null (a 'CO' owner) this renders
// exactly what the app has always shown — no behavior change at all.
export function ExchangeRateBalanceDisplay({
  balance,
  currency,
  ledger,
  rateMode = null,
  officialRateUsd = null,
  size = "lg",
  mainClassName,
  align = "start",
}: {
  balance: number;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  // Only needed to show the CUSTOM-mode badge — omit for a surface (like a
  // table cell) that's already dense enough without it.
  rateMode?: ExchangeRateMode | null;
  officialRateUsd?: number | null;
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
  const { primary, secondary } = formatLedgerAmount(balance, currency, ledger);

  if (!ledger || !currency) {
    return <p className={mainClass}>{primary}</p>;
  }

  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" && "items-end")}>
      <p className={mainClass}>{primary}</p>
      {secondary ? <p className="text-xs text-muted-foreground tabular-nums">{secondary} hoy</p> : null}
      {rateMode === "CUSTOM" ? <CustomRateBadge currentBcvUsd={officialRateUsd} /> : null}
    </div>
  );
}
