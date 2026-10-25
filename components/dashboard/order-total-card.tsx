"use client";

import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// «TOTAL A PAGAR» — frames `1653:12849` (paso 3/4) y el mismo nodo dentro de
// `1652:12831` (paso 2/4), leídos con el puente de escritorio el 2026-10-25.
//
// ===========================================================================
// UNA TARJETA Y NO DOS, PORQUE EL FRAME ES EL MISMO
//
// Los dos pasos la dibujan idéntica: 338×65, en HORIZONTAL, el rótulo a la
// izquierda y a la derecha el importe con su BANDERA y los bolívares debajo.
// Yo las había escrito a mano y por separado —en vertical, con el importe en
// `text-2xl` y sin bandera— y el dueño lo cazó el 2026-10-25 con el frame
// delante.
//
// LO QUE FALTABA NO ERA SOLO LA BANDERA. Era la forma entera: el frame pone
// el rótulo y la cifra en la MISMA línea, que es lo que hace que la tarjeta
// mida 65px y no ocupe media pantalla antes de los campos de pago.
//
// ===========================================================================
// LOS BOLÍVARES SE CAEN SOLOS DONDE NO LOS HAY
//
// `priceIn` devuelve `null` en un negocio colombiano —que no tiene segunda
// línea— y mientras el BCV no conteste. Las dos salen igual: sin la línea, no
// con un cero. Un «Bs. 0,00» bajo un importe real se lee como que la tasa es
// cero, que es peor que no decir nada.
// ===========================================================================
// EL TOTAL SE RECALCULA EN EL NAVEGADOR, Y NO ES UN CAPRICHO
//
// «Editar pedido» cambia la cantidad de una línea en el BORRADOR, que vive en
// `sessionStorage`. El servidor no lo ve, así que una tarjeta pintada sólo
// con lo que él manda se queda diciendo el total viejo después de editar —
// justo lo que el dueño reportó el 2026-10-25: *«no está realizando ninguna
// acción, o por lo menos no de cara al usuario»*.
//
// Y NO ES SÓLO COSMÉTICO: `registrarPedidoComoVenta` SÍ usa la cantidad
// editada, así que una tarjeta que no la mira enseñaría un total distinto del
// que se va a cobrar. Eso es exactamente lo que `CLAUDE.md` llama una cifra
// creíble y falsa.
//
// EL SERVIDOR SIGUE MANDANDO LAS LÍNEAS SELLADAS, que son la verdad del
// pedido; el borrador sólo las corrige donde el tendero tocó algo.
export function OrderTotalCard({
  pedidoId,
  lineas,
  moneda,
  rates,
}: {
  pedidoId: string;
  // Las líneas del bloque, tal y como el cliente las pidió. `productId` a
  // `null` es una línea descatalogada: no entra en la venta, así que tampoco
  // en el total.
  lineas: { id: string; productId: string | null; cantidad: number; precioUnitario: number }[];
  moneda: PriceCurrency;
  rates: BolivarRates | null;
}) {
  const borrador = useBorrador(pedidoId);
  const total =
    Math.round(
      lineas.reduce((suma, l) => {
        if (l.productId == null) return suma;
        const edicion = borrador?.editadas?.[l.id];
        // UNA LÍNEA MOVIDA A OTRA MONEDA SALE DE ESTE TOTAL. Si no, el bloque
        // de euros seguiría sumando algo que se va a cobrar en dólares.
        if (edicion && String(edicion.currency) !== String(moneda)) return suma;
        return suma + (edicion?.quantity ?? l.cantidad) * l.precioUnitario;
      }, 0) * 100,
    ) / 100;

  const enBs = rates
    ? (priceIn("VES", { amount: total, currency: moneda }, rates)?.amount ?? null)
    : null;

  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border bg-card p-3">
      <p className="text-sm text-muted-foreground">Total a pagar</p>
      <div className="flex flex-col items-end gap-0.5">
        <span className="flex items-center gap-1">
          <span className="text-base font-semibold tabular-nums">
            {formatPriceAmount(total, moneda)}
          </span>
          <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
        </span>
        {enBs != null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBs(enBs)} hoy
          </span>
        ) : null}
      </div>
    </div>
  );
}
