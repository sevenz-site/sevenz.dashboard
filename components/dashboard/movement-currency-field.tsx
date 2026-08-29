"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { formatBs } from "@/lib/exchange-rate/format";
import { LEDGER_CURRENCIES, type LedgerCurrency } from "@/lib/types";

// The USD/EUR choice, shown above the amount input (Tipo → Plazo → Moneda →
// Monto). Never Bs — an owner can't register a movement directly in
// bolívares, only ever USD or EUR. Only rendered when the owner is in
// country='VE' mode — the parent decides that.
export function LedgerCurrencyRadio({
  currency,
  onCurrencyChange,
}: {
  currency: LedgerCurrency;
  onCurrencyChange: (value: LedgerCurrency) => void;
}) {
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
    </div>
  );
}

// The live "≈ Bs. X" preview, shown directly below the amount input — it's
// a property of what was just typed there, recomputed client-side as the
// owner types using the rate already loaded when the dialog opened (no
// network call per keystroke).
export function BsAmountPreview({
  amount,
  currency,
  rateContext,
}: {
  amount: string;
  currency: LedgerCurrency;
  rateContext: MovementRateContext;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  const bsPreview = hasAmount ? toBs(parsed, currency, rateContext.effectiveRate) : null;

  return bsPreview !== null ? <p className="text-xs text-muted-foreground">≈ {formatBs(bsPreview)}</p> : null;
}
