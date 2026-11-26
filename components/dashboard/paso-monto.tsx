"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { NOMBRE } from "@/components/dashboard/pago-campos";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { formatBsHoy } from "@/lib/exchange-rate/format";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";
import { parseAmount, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// STEP 2 OF A SALE WITH NO PRODUCT: «2/4 Monto». Option A of «Omitir», chosen by the owner on
// 2026-11-25, with his addition of the same day: «Debajo del input "Monto de venta" agrega botón
// "Agregar monto en Euro" con estilo outlined», so the payment step draws both cards «como ocurre
// actualmente si selecciona producto con euros y dolares».
//
// ONE FIELD PER CURRENCY, NEVER TWO OF THE SAME. With one field its currency can be changed; with
// two, each one has its own and neither changes, or the pair could end up both in euros.
//
// ONLY THE CURRENCIES OF THE LEDGER (owner's decision: «Solo dólares y euros», pesos in
// Colombia). A Colombian sale has one book, so there is no menu and no second amount.
//
// THE DESCRIPTION IS THE SALE'S NAME, up to 120 characters like any line's, and it is asked here
// and not again in the payment sheet.

export type MontoTecleado = { currency: PriceCurrency; text: string };

/** Longest name of a sale line (migration 124). */
const MAX_DESCRIPCION = 120;

const SINGULAR: Partial<Record<PriceCurrency, string>> = { USD: "Dólar", EUR: "Euro" };

/** What each field holds as a number; `null` when there is nothing that can be charged. */
export function montoValido(text: string): number | null {
  const n = parseAmount(text);
  if (n == null || !Number.isFinite(n)) return null;
  const redondeado = Math.round(n * 100) / 100;
  return redondeado > 0 ? redondeado : null;
}

export function PasoMonto({
  montos,
  onMontos,
  descripcion,
  onDescripcion,
  monedas,
  rates,
  cargando,
  onReintentar,
  onContinuar,
}: {
  montos: MontoTecleado[];
  onMontos: (m: MontoTecleado[]) => void;
  descripcion: string;
  onDescripcion: (d: string) => void;
  /** The ledger's currencies. Empty while they are being read. */
  monedas: PriceCurrency[];
  rates: BolivarRates | null;
  cargando: boolean;
  onReintentar: () => void;
  onContinuar: () => void;
}) {
  // THE CURRENCIES COULD NOT BE READ: said, with a way out, instead of a form that would let the
  // shopkeeper type an amount and refuse it at the end with the client waiting.
  if (monedas.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          {cargando ? "Cargando…" : "No pudimos leer los datos de tu negocio. Revisa tu conexión."}
        </p>
        {cargando ? null : (
          <Button type="button" variant="outline" className="h-10" onClick={onReintentar}>
            Intentar de nuevo
          </Button>
        )}
      </div>
    );
  }

  const libre = monedas.find((m) => !montos.some((x) => x.currency === m));
  const listo = montos.length > 0 && montos.every((m) => montoValido(m.text) != null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {montos.map((m, i) => (
        <CampoDeMonto
          key={i}
          monto={m}
          etiqueta={montos.length > 1 ? `Monto en ${NOMBRE[m.currency] ?? m.currency}` : "Monto de la venta"}
          opciones={montos.length > 1 ? [] : monedas}
          rates={rates}
          onText={(text) => onMontos(montos.map((x, j) => (j === i ? { ...x, text } : x)))}
          onCurrency={(currency) => onMontos(montos.map((x, j) => (j === i ? { ...x, currency } : x)))}
          onQuitar={i > 0 ? () => onMontos(montos.filter((_, j) => j !== i)) : undefined}
        />
      ))}

      {libre ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={() => onMontos([...montos, { currency: libre, text: "" }])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar monto en {SINGULAR[libre] ?? NOMBRE[libre] ?? libre}
        </Button>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="venta-descripcion">Descripción (opcional)</Label>
        <Textarea
          id="venta-descripcion"
          className="min-h-24 text-base"
          maxLength={MAX_DESCRIPCION}
          placeholder="Ej.: recarga de teléfono"
          value={descripcion}
          onChange={(e) => onDescripcion(e.target.value)}
        />
      </div>

      <StickyActions>
        <Button type="button" className="h-10 w-full" disabled={!listo} onClick={onContinuar}>
          Continuar
        </Button>
      </StickyActions>
    </div>
  );
}

function CampoDeMonto({
  monto,
  etiqueta,
  opciones,
  rates,
  onText,
  onCurrency,
  onQuitar,
}: {
  monto: MontoTecleado;
  etiqueta: string;
  /** Empty: the currency is fixed and drawn as a plain chip. */
  opciones: PriceCurrency[];
  rates: BolivarRates | null;
  onText: (t: string) => void;
  onCurrency: (c: PriceCurrency) => void;
  onQuitar?: () => void;
}) {
  const { ref, onChange } = useGroupedAmount(monto.text, onText, 2);
  const id = `venta-monto-${monto.currency}`;
  const valor = montoValido(monto.text);
  const tasa = rates ? (monto.currency === "EUR" ? rates.eur : rates.usd) : null;
  const nombre = NOMBRE[monto.currency] ?? monto.currency;
  const moneda = (
    <>
      <CurrencyFlagIcon currency={monto.currency} className="size-4 shrink-0" />
      <span className="text-xs">{nombre}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{etiqueta}</Label>
        {onQuitar ? (
          <button
            type="button"
            aria-label={`Quitar el ${etiqueta.toLowerCase()}`}
            onClick={onQuitar}
            className="-m-1 rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="flex items-stretch gap-2">
        <Input
          id={id}
          ref={ref}
          className="h-10 min-w-0 flex-1"
          inputMode="decimal"
          autoComplete="off"
          placeholder="00"
          value={monto.text}
          onChange={onChange}
        />
        {opciones.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-10 w-32 shrink-0 justify-between gap-2" aria-label="Moneda de la venta">
                {moneda}
                <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {opciones.map((c) => (
                <DropdownMenuItem key={c} onSelect={() => onCurrency(c)}>
                  <CurrencyFlagIcon currency={c} className="size-4 shrink-0" />
                  {NOMBRE[c] ?? c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="flex h-10 w-28 shrink-0 items-center gap-2 rounded-[10px] border px-3">{moneda}</span>
        )}
      </div>
      {/* The bolívares of today, under what was typed and never in its place. */}
      {valor != null && tasa ? (
        <p className="text-xs text-muted-foreground tabular-nums">{formatBsHoy(valor * tasa)}</p>
      ) : null}
    </div>
  );
}
