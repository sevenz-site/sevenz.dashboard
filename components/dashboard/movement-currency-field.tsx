"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { etiquetaDePrevista, tocaOfrecerPrevista } from "@/lib/exchange-rate/tasa-prevista";
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
  usarPrevista = false,
}: {
  amount: string;
  currency: LedgerCurrency;
  rateContext: MovementRateContext;
  usarPrevista?: boolean;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  // La misma tasa que el servidor va a sellar, no una copia calculada aparte:
  // el objeto viene del servidor y la casilla solo elige cuál de las dos usar.
  const prevista = rateContext.prevista;
  const tasa =
    usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext.effectiveRate;
  const bsPreview = hasAmount ? toBs(parsed, currency, tasa) : null;

  return bsPreview !== null ? <p className="text-xs text-muted-foreground">≈ {formatBs(bsPreview)}</p> : null;
}

// La casilla que aplica la tasa prevista, debajo del equivalente en bolívares.
//
// Solo se dibuja dentro de la ventana —viernes al mediodía, fin de semana— y
// solo si hay una tasa futura publicada. Es la misma regla que usan las dos
// calculadoras, importada del mismo sitio para que no puedan separarse.
//
// Manda "1", no la cifra: el servidor busca la tasa en lo que ya tiene guardado.
// Si mandara el número, una petición hecha a mano podría sellar cualquier cosa.
export function PrevistaCheckbox({
  rateContext,
  checked,
  onCheckedChange,
}: {
  rateContext: MovementRateContext;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const prevista = rateContext.prevista;
  if (!tocaOfrecerPrevista(prevista?.fecha, rateContext.rateDate)) return null;

  return (
    <>
      {/* mb-1 sobre el gap del formulario, igual que en la calculadora: el
          label ocupa todo el ancho y sin ese aire el dedo cae en el campo de
          abajo al intentar marcarla. */}
      <label className="mb-1 flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" />
        <span>Aplicar tasa BCV prevista para {etiquetaDePrevista(prevista!.fecha)}</span>
      </label>
      {checked ? <input type="hidden" name="usar_tasa_prevista" value="1" /> : null}
    </>
  );
}
