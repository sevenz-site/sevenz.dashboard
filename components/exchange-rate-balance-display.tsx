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
  leading,
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
  // Algo que va PEGADO a la cifra, no encima ni debajo: hoy la bandera de la
  // moneda en la tarjeta de capital. Va aquí dentro y no envolviendo este
  // componente a propósito — envolviéndolo, la línea de bolívares quedaría
  // sangrada bajo la cifra en vez de alineada al borde de la tarjeta.
  leading?: React.ReactNode;
}) {
  const mainClass = cn(
    size === "lg" ? "text-2xl font-semibold tabular-nums" : "text-lg font-semibold tabular-nums",
    mainClassName,
  );
  const { primary, secondary } = formatLedgerAmount(balance, currency, ledger);

  // `flex` solo cuando hay algo que alinear: sin esto, un `<p>` que antes era
  // bloque pasaría a ser contenedor flex en los seis sitios que ya lo usan.
  const mainWithLeading = leading ? (
    <p className={cn("flex items-center gap-2", mainClass)}>
      {leading}
      {primary}
    </p>
  ) : (
    <p className={mainClass}>{primary}</p>
  );

  if (!ledger || !currency || !showSecondary) {
    return mainWithLeading;
  }

  return (
    <div className={cn("flex flex-col gap-0.5", align === "end" && "items-end")}>
      {mainWithLeading}
      {secondary ? <p className="text-xs text-muted-foreground tabular-nums">{secondary} hoy</p> : null}
    </div>
  );
}
