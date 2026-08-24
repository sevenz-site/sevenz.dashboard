"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomRateBadge } from "@/components/exchange-rate-custom-badge";
import {
  MOVEMENT_CURRENCY_OPTIONS,
  toUsd,
  usdToBs,
  type MovementCurrency,
  type MovementRateContext,
} from "@/lib/exchange-rate/convert";
import { formatBs } from "@/lib/exchange-rate/format";

// Shared by both the "Nuevo cliente" and "Agregar movimiento" forms: a
// currency select plus a read-only "≈ Bs. X" preview that recomputes
// client-side as the owner types, using the rate already loaded when the
// dialog opened (no network call per keystroke). Only rendered at all when
// the owner is in country='VE' mode — the parent decides that.
export function MovementCurrencyField({
  amount,
  currency,
  onCurrencyChange,
  rateContext,
}: {
  amount: string;
  currency: MovementCurrency;
  onCurrencyChange: (value: MovementCurrency) => void;
  rateContext: MovementRateContext;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  // Round-trips through USD (what actually gets stored) rather than
  // converting straight to Bs, so the preview shows the same figure the
  // ledger will report back.
  const bsPreview = hasAmount
    ? usdToBs(toUsd(parsed, currency, rateContext.effectiveRate), rateContext.effectiveRate)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <Select
        name="movement_currency"
        value={currency}
        onValueChange={(v) => onCurrencyChange(v as MovementCurrency)}
      >
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOVEMENT_CURRENCY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {bsPreview !== null ? <p className="text-xs text-muted-foreground">≈ {formatBs(bsPreview)}</p> : null}
      {rateContext.rateMode === "CUSTOM" ? (
        <CustomRateBadge currentBcvUsd={rateContext.officialRateUsd} />
      ) : null}
    </div>
  );
}
