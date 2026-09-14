"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { etiquetaDePrevista, tocaOfrecerPrevista } from "@/lib/exchange-rate/tasa-prevista";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import { LEDGER_CURRENCIES, MONEDAS_TECLEABLES, type LedgerCurrency, type MonedaTecleada } from "@/lib/types";

// En qué moneda ESCRIBE el dueño: bolívares, dólares o euros.
//
// Es distinto de en qué libro entra la deuda. El cliente paga en bolívares y la
// deuda vive en dólares o en euros, así que "bolívares" aquí no crea un tercer
// libro — es una forma de teclear el monto. Cuál de los dos libros recibe la
// deuda se elige en el desplegable de abajo, que solo aparece en ese caso.
//
// Botones y no radios porque es la misma decisión que la calculadora ya
// presenta así, y porque tres opciones con nombre completo en una fila de
// teléfono necesitan área de toque, no un circulito de 16px.
export function MonedaTecleadaButtons({
  value,
  onValueChange,
}: {
  value: MonedaTecleada;
  onValueChange: (value: MonedaTecleada) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Moneda a registrar</Label>
      <div className="flex flex-row flex-wrap gap-2">
        {MONEDAS_TECLEABLES.map((m) => (
          <Button
            key={m.value}
            type="button"
            variant={value === m.value ? "default" : "outline"}
            size="sm"
            onClick={() => onValueChange(m.value)}
            aria-pressed={value === m.value}
          >
            <CurrencyFlagIcon currency={m.value === "VES" ? "VES" : m.value} />
            {m.label}
          </Button>
        ))}
      </div>
      {/* El libro al que va la deuda. Cuando se teclea en dólares o en euros es
          el mismo que la moneda tecleada; cuando se teclea en bolívares lo
          decide el desplegable. */}
      <input type="hidden" name="moneda_tecleada" value={value} />
    </div>
  );
}

// El libro donde entra la deuda, cuando el monto se escribió en bolívares.
// Solo aparece en ese caso: tecleando dólares, el libro es el de dólares y
// preguntarlo sería ofrecer una decisión que no existe.
export function LibroDestinoSelect({
  value,
  onValueChange,
}: {
  value: LedgerCurrency;
  onValueChange: (value: LedgerCurrency) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as LedgerCurrency)}>
      <SelectTrigger className="w-[9.5rem]" aria-label="Moneda en la que se guarda">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEDGER_CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>
            {c === "USD" ? "Dólares" : "Euros"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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

// Cuánto se va a guardar de verdad, en la moneda del libro.
//
// Cuando el dueño teclea bolívares, esta es la única cifra que le dice qué va a
// quedar anotado: la deuda vive en dólares o en euros, no en bolívares. Se
// calcula con la MISMA tasa que el servidor va a sellar —la vigente, o la
// prevista si marcó la casilla— para que lo que ve y lo que se guarda no puedan
// discrepar.
export function montoConvertido(
  bolivares: string,
  destino: LedgerCurrency,
  rateContext: MovementRateContext,
  usarPrevista: boolean,
): number | null {
  const bs = Number(bolivares);
  if (!Number.isFinite(bs) || bs <= 0) return null;
  const prevista = rateContext.prevista;
  const tasa = usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext.effectiveRate;
  const porUnidad = destino === "USD" ? tasa.usd : tasa.eur;
  if (!porUnidad || porUnidad <= 0) return null;
  // Los mismos dos decimales que aplica el servidor. Si esta línea y la del
  // servidor se separaran, el dueño vería una cifra y se guardaría otra.
  return Math.round((bs / porUnidad) * 100) / 100;
}

// La fila "Monto a registrar", con el desplegable del libro al lado. Solo
// aparece cuando se tecleó en bolívares.
export function MontoARegistrarRow({
  bolivares,
  destino,
  onDestinoChange,
  rateContext,
  usarPrevista,
}: {
  bolivares: string;
  destino: LedgerCurrency;
  onDestinoChange: (value: LedgerCurrency) => void;
  rateContext: MovementRateContext;
  usarPrevista: boolean;
}) {
  const monto = montoConvertido(bolivares, destino, rateContext, usarPrevista);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">Monto a registrar</span>
          <span className="text-lg font-semibold tabular-nums">
            {monto === null ? "—" : formatDisplayCurrency(monto, destino)}
          </span>
        </div>
        <LibroDestinoSelect value={destino} onValueChange={onDestinoChange} />
      </div>
      <p className="text-xs text-muted-foreground">
        El {destino === "USD" ? "fiado o abono" : "fiado o abono"} queda guardado en{" "}
        {destino === "USD" ? "dólares" : "euros"} a la tasa equivalente. Los bolívares que
        escribiste quedan anotados en el respaldo.
      </p>
    </div>
  );
}

// El resumen de antes de guardar. Repite la cifra que se va a anotar, en verde
// si el dinero entra y en rojo si sale. No se toca: es lo último que el dueño
// lee antes de pulsar, no otro sitio donde cambiar algo.
export function ResumenMonto({
  type,
  monto,
  moneda,
  rateContext,
  usarPrevista,
}: {
  type: "charge" | "payment";
  monto: number | null;
  moneda: LedgerCurrency | null;
  rateContext: MovementRateContext | null;
  usarPrevista: boolean;
}) {
  if (monto === null || monto <= 0) return null;

  const prevista = rateContext?.prevista;
  const tasa =
    usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext?.effectiveRate;
  const bs = moneda && tasa ? toBs(monto, moneda, tasa) : null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">Monto a registrar</span>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            type === "payment" ? "text-money-in" : "text-destructive"
          }`}
        >
          {moneda ? formatDisplayCurrency(monto, moneda) : formatCurrency(monto)}
        </span>
        {bs !== null ? <span className="text-xs text-muted-foreground">≈ {formatBs(bs)}</span> : null}
      </div>
      {moneda ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {moneda === "USD" ? "Dólares" : "Euros"}
          <CurrencyFlagIcon currency={moneda} />
        </span>
      ) : null}
    </div>
  );
}
