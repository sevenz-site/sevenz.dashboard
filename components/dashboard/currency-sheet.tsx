"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ETIQUETA_MONEDA } from "@/components/public/product-detail";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

// EN QUÉ MONEDA SE COBRA ESTA LÍNEA — frame `1389:8910`.
//
// ===========================================================================
// LO QUE PIDIÓ EL DUEÑO ES LA EQUIVALENCIA, NO LA LISTA
//
// «debe mostrar la equivalencia del precio en cada moneda» (2026-10-18). Y es
// la diferencia entre un selector que sirve y uno que no: la pregunta real del
// tendero no es «¿dólares o euros?», es «¿cuánto le cobro en cada uno?».
//
// Las cifras NO se convierten aquí: cada una sale de `precioEnMoneda` para esa
// moneda, que es lo que respeta un precio fijado a mano. Un producto con 10 $
// y 9 € escritos por el tendero tiene que enseñar 9 €, no los 9,20 que daría
// la tasa — ese precio lo puso él y es el que piensa cobrar.
//
// Y POR ESO LA LISTA LLEGA YA CALCULADA, no como monedas a convertir: quien
// monta esta hoja es quien tiene el bloque de precios y la cantidad, y
// calcularlo aquí obligaría a pasarle los dos y duplicar la regla del escalón.
export function CurrencySheet({
  open,
  onOpenChange,
  opciones,
  seleccionada,
  onSeleccionar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Cada moneda que esta línea admite, con lo que suma en ella.
  opciones: { currency: PriceCurrency; subtotal: number }[];
  seleccionada: PriceCurrency;
  onSeleccionar: (c: PriceCurrency) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-base font-medium">Selecciona moneda</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* UNA TARJETA CON LAS FILAS DENTRO, como el frame: el borde agrupa
              las opciones y deja claro que son excluyentes entre sí. */}
          <div className="flex flex-col gap-1 rounded-[10px] border p-2.5">
            {opciones.map(({ currency, subtotal }) => {
              const activa = currency === seleccionada;
              return (
                <button
                  key={currency}
                  type="button"
                  // SE ELIGE Y SE CIERRA. El frame tiene además «Continuar»,
                  // que queda abajo: sirve para quien toca la fila y duda, o
                  // para quien solo vino a mirar las equivalencias y se va con
                  // la que ya tenía.
                  onClick={() => onSeleccionar(currency)}
                  aria-pressed={activa}
                  className="flex items-center justify-between gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {/* EL PUNTO DIBUJADO Y NO UN `input[type=radio]`: toda la
                        fila es el control, así que un radio real dentro sería
                        un segundo blanco para la misma acción. `aria-pressed`
                        de arriba es lo que lo cuenta al lector de pantalla. */}
                    <span
                      aria-hidden="true"
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        activa ? "border-foreground" : "border-muted-foreground/40"
                      }`}
                    >
                      {activa ? <span className="size-2 rounded-full bg-foreground" /> : null}
                    </span>
                    <CurrencyFlagIcon currency={currency} className="size-4 shrink-0" />
                    <span className="truncate text-xs">{ETIQUETA_MONEDA[currency] ?? currency}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">
                    {formatPriceAmount(subtotal, currency)}
                  </span>
                </button>
              );
            })}
          </div>

          <Button type="button" className="h-10 w-full" onClick={() => onOpenChange(false)}>
            Continuar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
