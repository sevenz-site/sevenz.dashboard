import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { cn } from "@/lib/utils";
import type { LedgerCurrency } from "@/lib/types";

// Renders ONE currency's balance — USD and EUR are independent debts shown
// as separate blocks/columns by every caller (dashboard KPI cards, client
// table columns, client detail, public client screen), never combined into
// one figure. When currency/ledger is null (a 'CO' owner) this renders
// exactly what the app has always shown — no behavior change at all.
export function ExchangeRateBalanceDisplay({
  balance,
  currency,
  ledger,
  size = "lg",
  mainClassName,
  align = "start",
  showSecondary = true,
}: {
  balance: number;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  size?: "lg" | "sm";
  // Lets a caller with its own established styling (e.g. the dashboard's
  // amber text-3xl KPI figure) keep it, instead of the default here.
  mainClassName?: string;
  // The client detail page's desktop layout right-aligns this whole block.
  align?: "start" | "end";
  // Drops the "Bs. X hoy" line while keeping the primary amount formatted in
  // its own currency. Passing ledger={null} would also hide it, but would
  // silently reformat a USD figure with the COP formatter — a money-display
  // bug, not a styling choice.
  showSecondary?: boolean;
}) {
  const mainClass = cn(
    size === "lg" ? "text-2xl font-semibold tabular-nums" : "text-lg font-semibold tabular-nums",
    mainClassName,
  );
  const { primary, secondary } = formatLedgerAmount(balance, currency, ledger);

  if (!ledger || !currency || !showSecondary) {
    return <p className={mainClass}>{primary}</p>;
  }

  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" && "items-end")}>
      <p className={mainClass}>{primary}</p>
      {secondary ? <p className="text-xs text-muted-foreground tabular-nums">{secondary} hoy</p> : null}
    </div>
  );
}
