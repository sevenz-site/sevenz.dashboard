"use client";

import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderCurrencyRemoveButton } from "@/components/dashboard/order-currency-remove-button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import {
  tieneAlgoQueCobrar,
  type BloqueDeMoneda,
} from "@/lib/orders/bloques-de-moneda";
import {
  currencyName,
  formatPriceAmount,
  priceIn,
  type BolivarRates,
} from "@/lib/products/price";

// ONE CURRENCY BLOCK OF `1/4 Pedido` — frame `1654:15548` («Order Section»),
// read with the desktop bridge on 2026-10-25.
//
// ===========================================================================
// THIS CARD IS `CT-147`
//
// Before it, the screen drew one card PER PRODUCT and each one was registered
// on its own: eight products meant sixteen screens, and two of them in the
// same currency with different terms meant one of the terms was silently
// dropped. The owner: *«el registro/pago debería hacerse por moneda no por
// producto (…) no puede salir a producción así»*.
//
// So the unit of work is this card. Its «Registrar» opens `2/4` for the whole
// block, and the term is asked once, at `3/4`, for everything in it.
//
// ===========================================================================
// «REGISTRAR» OR «EDITAR», AND WHAT THAT PAIR MEANS
//
// The frame draws the dollar block with «Editar» and the euro block with
// «Registrar». Asked which state that was, the owner answered on 2026-10-25
// that the dollar block **is not registered yet**: nothing is written until
// the last block is filled in and the flow finishes.
//
// So the pair is about the DRAFT, not the ledger: «Registrar» on a block
// nobody has filled in, «Editar» on one that already has an amount waiting.
// Which is also why this card has to be a client component — only the browser
// knows what is in the draft.
function conMayuscula(palabra: string): string {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1);
}

export function OrderCurrencyBlockCard({
  pedidoId,
  bloque,
  rates,
  hrefRegistrar,
  sePuedeQuitar,
}: {
  pedidoId: string;
  bloque: BloqueDeMoneda;
  rates: BolivarRates | null;
  hrefRegistrar: string;
  // ── ¿SE PUEDE QUITAR ESTA MONEDA? ─────────────────────────────────
  //
  // `false` cuando es la única que le queda al pedido: entonces el botón no
  // se dibuja. Decisión del dueño el 2026-10-26 --un pedido vacío no se puede
  // registrar y no tiene nada que enseñar, así que ofrecerlo sería llevarlo a
  // un callejón--.
  //
  // LO DECIDE LA PÁGINA Y NO ESTA TARJETA porque la pregunta es sobre el
  // pedido entero y cada tarjeta solo conoce su bloque. La acción del
  // servidor lo vuelve a comprobar: esta pantalla puede ser una pestaña vieja
  // que todavía dibuja dos.
  sePuedeQuitar: boolean;
}) {
  const borrador = useBorrador(pedidoId);
  const yaTieneMonto = borrador?.monedas?.[bloque.moneda] != null;
  const registrable = tieneAlgoQueCobrar(bloque);

  // `?.amount ?? null`: `priceIn` devuelve null cuando no hay tasa para esa
  // moneda, que en un negocio colombiano es SIEMPRE —no hay bolívares que
  // enseñar— y en uno venezolano es el rato en que el BCV no contesta. Las
  // dos salen igual: sin la línea de abajo, no con un cero.
  const enBs = rates
    ? (priceIn("VES", { amount: bloque.total, currency: bloque.moneda }, rates)
        ?.amount ?? null)
    : null;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2.5 pb-4">
        {/* «en Dólares», con MAYÚSCULA, que es como lo escribe el frame
            (`1654:15548`). `currencyName` devuelve la palabra en minúscula
            porque en el resto de la app va dentro de una frase; aquí es el
            final de un título. */}
        <h3 className="flex-1 text-base font-semibold">
          Resumen de pedido en {conMayuscula(currencyName(bloque.moneda))}
        </h3>
        <CurrencyFlagIcon currency={bloque.moneda} className="size-6 shrink-0" />
      </div>

      {/* THE THREE COLUMNS OF THE FRAME, and their widths are its: the name
          takes about 40% and the two figures split the rest. `tabular-nums`
          so a column of amounts lines up, which the frame gets for free from
          its own font and a browser does not. */}
      <div className="flex flex-col gap-2 pb-3">
        <div className="flex gap-1.5 text-xs text-muted-foreground">
          <span className="flex-[1.4]">Producto</span>
          <span className="flex-1 text-right">Cantidad</span>
          <span className="flex-1 text-right">Por pagar</span>
        </div>
        {bloque.lineas.map((l) => (
          <div key={l.id} className="flex gap-1 text-xs">
            <span className="flex-[1.4] truncate">{l.nombre}</span>
            <span className="flex-1 text-right tabular-nums">
              {formatCantidad(l.cantidad)}
            </span>
            <span className="flex-1 text-right tabular-nums">
              {l.productId == null ? (
                // A LINE WHOSE PRODUCT LEFT THE CATALOGUE. The owner's
                // decision of 2026-10-24 is that it is excluded and said so —
                // here that is a dash instead of a figure, because a price
                // for something that cannot be sold would be a promise.
                <span className="text-muted-foreground">—</span>
              ) : (
                formatPriceAmount(l.precioUnitario * l.cantidad, bloque.moneda)
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-start justify-between gap-1 border-t pt-2">
        <span className="text-base font-semibold">Total</span>
        <div className="flex flex-col items-end gap-1">
          <span className="text-base font-semibold tabular-nums">
            {formatPriceAmount(bloque.total, bloque.moneda)}
          </span>
          {enBs != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBs(enBs)}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── LOS DOS BOTONES, A MEDIO ANCHO CADA UNO ──────────────────
          Frames `1708:15285` (pre-registrado) y `1708:15082` (por
          registrar), medidos: fila horizontal, 16px entre ellos, 16 de aire
          arriba y los dos del mismo ancho. «Eliminar» va en plano --sin
          relleno ni borde-- y al lado el de siempre: relleno oscuro para
          «Registrar», con borde para «Editar».

          «ELIMINAR» A LA IZQUIERDA, que es donde lo pone el frame. No es
          indiferente: el pulgar derecho cae antes en la derecha, y ahí está
          el botón que NO destruye nada. */}
      <div className="flex gap-4 pt-4">
        {registrable && sePuedeQuitar ? (
          <OrderCurrencyRemoveButton
            pedidoId={pedidoId}
            moneda={bloque.moneda}
            // CUÁNTOS SE LLEVA, para que el diálogo lo diga. «¿Seguro?» a
            // secas es una frase que se toca sin leer.
            cuantosProductos={bloque.lineas.length}
            className="h-10 flex-1"
          />
        ) : null}
        {registrable ? (
          <Button
            variant={yaTieneMonto ? "outline" : "default"}
            className="h-10 flex-1"
            asChild
          >
            <Link href={hrefRegistrar}>
              {yaTieneMonto ? (
                <Pencil className="size-5" />
              ) : (
                <Plus className="size-5" />
              )}
              {yaTieneMonto ? "Editar" : "Registrar"}
            </Link>
          </Button>
        ) : (
          // NO BUTTON AT ALL, and a reason instead. Offering «Registrar» on a
          // block the server is going to refuse teaches the shopkeeper that
          // the app's buttons sometimes do nothing — and the refusal would
          // arrive three screens later, after they filled in an amount.
          <p className="text-xs text-muted-foreground">
            Ninguno de estos productos sigue en tu catálogo, así que no hay
            nada que cobrar en {currencyName(bloque.moneda).toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}
