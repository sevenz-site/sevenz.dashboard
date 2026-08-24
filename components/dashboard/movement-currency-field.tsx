"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CustomRateBadge } from "@/components/exchange-rate-custom-badge";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { formatBs } from "@/lib/exchange-rate/format";
import { LEDGER_CURRENCIES, type LedgerCurrency } from "@/lib/types";

// Shared by the "Nuevo cliente" and "Agregar movimiento" forms: a USD/EUR
// radio choice (never Bs — an owner can't register a movement directly in
// bolívares) plus a read-only "≈ Bs. X" preview that recomputes client-side
// as the owner types, using the rate already loaded when the dialog opened.
// Only rendered when the owner is in country='VE' mode — the parent decides
// that.
export function MovementCurrencyField({
  amount,
  currency,
  onCurrencyChange,
  rateContext,
}: {
  amount: string;
  currency: LedgerCurrency;
  onCurrencyChange: (value: LedgerCurrency) => void;
  rateContext: MovementRateContext;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  const bsPreview = hasAmount ? toBs(parsed, currency, rateContext.effectiveRate) : null;

  return (
    <div className="flex flex-col gap-2">
      <Label>Moneda</Label>
      <RadioGroup
        name="movement_currency"
        value={currency}
        onValueChange={(v) => onCurrencyChange(v as LedgerCurrency)}
        className="flex flex-row gap-4"
      >
        {LEDGER_CURRENCIES.map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={c} />
            {c}
          </label>
        ))}
      </RadioGroup>
      {bsPreview !== null ? <p className="text-xs text-muted-foreground">≈ {formatBs(bsPreview)}</p> : null}
      {rateContext.rateMode === "CUSTOM" ? (
        <CustomRateBadge currentBcvUsd={rateContext.officialRateUsd} />
      ) : null}
    </div>
  );
}
