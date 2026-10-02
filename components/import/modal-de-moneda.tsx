"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Shuffle } from "lucide-react";
import type { LedgerCurrency } from "@/lib/types";

// La pregunta de la moneda, de una vez y para toda la tanda.
//
// POR QUÉ UNA MODAL Y NO SOLO EL SELECTOR DE LA LISTA. La foto no dice la
// moneda: una libreta escribe "50" y el dueño sabe si son dólares o euros. Ese
// dato tiene que entrar a mano, y mientras no entre NINGÚN movimiento se puede
// guardar. Preguntarlo en un recuadro más, entre los demás, es lo que llevaba a
// revisar veinte clientes y encontrarse el bloqueo al final.
//
// TRES OPCIONES, NO DOS. Las dos primeras asignan de un toque, que es el caso
// normal. La tercera —"Están mezclados"— no asigna nada y deja todo en "Moneda
// no identificada", para la libreta que de verdad mezcla: sin ella la única
// salida sería elegir una moneda falsa y corregir a mano, es decir, meter un
// dato incorrecto para poder pasar de pantalla.
//
// SE PUEDE CERRAR. Sale al entrar a la revisión, o sea que el dueño responde
// ANTES de haber visto un solo movimiento — y a veces la respuesta honesta es
// "déjame mirar primero". Cerrarla no pierde nada: el selector del pie de la
// lista hace lo mismo y la vuelve a abrir.
export function ModalDeMoneda({
  abierta,
  onCerrar,
  onElegir,
  clientes,
  movimientos,
}: {
  abierta: boolean;
  onCerrar: () => void;
  onElegir: (moneda: LedgerCurrency) => void;
  clientes: number;
  movimientos: number;
}) {
  return (
    <Dialog open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-[min(92vw,420px)]">
        <DialogHeader>
          <DialogTitle>¿En qué moneda está esta libreta?</DialogTitle>
          {/* Lo que se leyó, antes de pedir nada. Es la respuesta a la primera
              pregunta que el dueño tiene al llegar —"¿las leyó todas?"— y
              contestarla aquí hace que la moneda se elija sobre algo concreto y
              no a ciegas. */}
          <DialogDescription>
            Leímos {movimientos} movimiento{movimientos === 1 ? "" : "s"} de {clientes} cliente
            {clientes === 1 ? "" : "s"}. Elige la moneda y la aplicamos a todos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {(
            [
              { moneda: "USD", etiqueta: "Todo en dólares" },
              { moneda: "EUR", etiqueta: "Todo en euros" },
            ] as const
          ).map(({ moneda, etiqueta }) => (
            <Button
              key={moneda}
              type="button"
              variant="outline"
              // `justify-start` y no centrado: son dos filas que se comparan, y
              // con el texto centrado la bandera de cada una cae en un sitio
              // distinto según lo que mida la palabra.
              className="h-12 justify-start gap-3 text-base"
              onClick={() => onElegir(moneda)}
            >
              <CurrencyFlagIcon currency={moneda} className="size-5" />
              {etiqueta}
            </Button>
          ))}

          {/* La tercera no comparte estilo con las dos de arriba a propósito:
              no es una moneda más, es decir que no hay una sola. `ghost` la
              baja de peso sin esconderla. */}
          <Button
            type="button"
            variant="ghost"
            className="h-12 justify-start gap-3 text-base text-muted-foreground"
            onClick={onCerrar}
          >
            <Shuffle className="size-5" />
            Están mezclados
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Si están mezclados, eliges la moneda cliente por cliente al revisarlos.
        </p>
      </DialogContent>
    </Dialog>
  );
}
