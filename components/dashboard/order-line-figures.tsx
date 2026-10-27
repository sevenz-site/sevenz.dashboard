"use client";

import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// LAS CIFRAS DE UNA LÍNEA DEL PASO 2/4, LEÍDAS DEL BORRADOR.
//
// ===========================================================================
// POR QUÉ ESTO NO LO PUEDE PINTAR EL SERVIDOR
//
// «Editar pedido» guarda la cantidad nueva en `sessionStorage`, que el
// servidor no ve. Pintada desde él, la fila se quedaba diciendo «Cantidad del
// pedido: 1» después de que el tendero pusiera 3 — y el dueño lo reportó el
// 2026-10-25 como que el botón *«no está realizando ninguna acción»*. La
// acción ocurría; lo que no ocurría era decirlo.
//
// NO BASTA CON `router.refresh()`: refrescar vuelve a pedirle la pantalla al
// servidor, y el servidor sigue sin ver el borrador. La corrección tiene que
// hacerse donde el borrador existe.
//
// ===========================================================================
// «EL CLIENTE PIDIÓ X» SOLO CUANDO DIFIERE
//
// Decisión del dueño del 2026-10-24: *«el resumen final debe decir "el
// cliente pidió 5" y lo que se está registrando cuando difiera»*. Si no
// difiere, el paréntesis sería ruido en todas las filas.
// DOS COMPONENTES Y NO UNO, aunque lean lo mismo: la cantidad va en la
// columna izquierda de la fila y el importe en la derecha, y un solo
// componente que devolviera los dos los metería a los dos en el mismo lado.
// Se vio al montarlo.
export function CantidadDeLinea({
  pedidoId,
  lineaId,
  cantidadPedida,
}: {
  pedidoId: string;
  lineaId: string;
  cantidadPedida: number;
}) {
  const borrador = useBorrador(pedidoId);
  const cantidad = borrador?.editadas?.[lineaId]?.quantity ?? cantidadPedida;

  return (
    <p className="text-sm text-muted-foreground">
      Cantidad del pedido: {formatCantidad(cantidad)}
      {cantidad !== cantidadPedida ? (
        <span className="text-xs"> (el cliente pidió {formatCantidad(cantidadPedida)})</span>
      ) : null}
    </p>
  );
}

// El importe de la misma fila, con las mismas reglas: lee el borrador, y una
// línea movida de moneda lo dice en vez de enseñar una cifra que ya no es de
// este bloque.
export function ImporteDeLinea({
  pedidoId,
  lineaId,
  cantidadPedida,
  precioUnitario,
  moneda,
  rates,
  hayProducto,
}: {
  pedidoId: string;
  lineaId: string;
  cantidadPedida: number;
  precioUnitario: number;
  moneda: PriceCurrency;
  rates: BolivarRates | null;
  hayProducto: boolean;
}) {
  const borrador = useBorrador(pedidoId);
  const edicion = borrador?.editadas?.[lineaId];
  const cantidad = edicion?.quantity ?? cantidadPedida;

  // UNA LÍNEA MOVIDA A OTRA MONEDA deja de pertenecer a este bloque. Se dice,
  // en vez de enseñar un importe en una moneda que ya no es la suya: el
  // tendero acaba de moverla y tiene que poder ver que lo hizo.
  const movidaA =
    edicion && String(edicion.currency) !== String(moneda)
      ? String(edicion.currency)
      : null;

  // EL PRECIO DE LA EDICIÓN MANDA SOBRE EL SELLADO. Decisión del dueño el
  // 2026-10-26: cambiar la cantidad recalcula el escalón, así que una línea
  // que sube al mínimo de mayoreo cuesta el precio al mayor. El porqué entero
  // --y la decisión que desplaza-- está en `LineaEditada.unitPrice`.
  const precio = edicion?.unitPrice ?? precioUnitario;
  const porPagar = Math.round(precio * cantidad * 100) / 100;
  const enBs =
    rates != null && !movidaA
      ? (priceIn("VES", { amount: porPagar, currency: moneda }, rates)?.amount ?? null)
      : null;

  return (
    <div className="shrink-0 text-right">
      {movidaA ? (
        <p className="text-sm text-muted-foreground">Movido a {movidaA}</p>
      ) : (
        <>
          {/* ── LA BANDERA, PEGADA AL IMPORTE ───────────────────────────
              El frame dibuja «Price With Currency»: la cifra y su bandera en
              la misma línea. El dueño lo pidió el 2026-10-26 --*«monto total
              del producto debe llevar bandera»*-- y es la misma forma que ya
              tienen la tarjeta «Total a pagar» de arriba y los totales del
              carrito del cliente.

              Y AQUÍ GANA MÁS QUE EN OTRAS: esta pantalla confirma UNA moneda
              de un pedido que puede tener dos, y el símbolo solo no separa
              dos dólares. La bandera dice en cuál de los dos libros va a
              caer esta línea.

              `items-center` Y NO `baseline`: una bandera no tiene línea base
              y con la otra se monta sobre el número. */}
          <span className="flex items-center justify-end gap-1">
            <span className="font-semibold tabular-nums">
              {hayProducto ? formatPriceAmount(porPagar, moneda) : "—"}
            </span>
            {hayProducto ? (
              <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
            ) : null}
          </span>
          {enBs != null && hayProducto ? (
            <p className="text-xs text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</p>
          ) : null}
        </>
      )}
    </div>
  );
}
