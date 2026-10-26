"use client";

import { leerUnaVezAlEntrar } from "@/lib/suscripcion-de-almacenamiento";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { PagoCampos, type Registro } from "@/components/dashboard/pago-campos";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import {
  borrarBorrador,
  fijarPagoDeMoneda,
  leerBorrador,
  leerPagoDeMoneda,
  type PagoDeMoneda,
} from "@/lib/orders/borrador-de-registro";
import { registrarTodoElPedido } from "@/lib/orders/registrar-todo";
import {
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// STEP `3/4 Pago` OF REGISTERING A CATALOGUE ORDER — frame `1653:12718`,
// read with the desktop bridge on 2026-10-25.
//
// ===========================================================================
// ONE PAYMENT FOR THE WHOLE CURRENCY, WHICH IS `CT-147`
//
// This screen used to be «2/2 Abono» and belonged to ONE LINE. Asking per
// line meant asking for the term per line, and `registrarVenta`'s credit has
// always been per currency: two dollar lines with different terms and one of
// them was dropped on the way in. The app then kept a deadline the shopkeeper
// never agreed to, and the status chip stopped warning about a fiado that was
// overdue for him three weeks earlier.
//
// So the amount, the term and the instalments are asked ONCE, for the whole
// block, and `total` is the block's total. There is nothing left to reconcile.
//
// THE CREDIT FIELDS ARE THE SALE WIZARD'S, the owner's decision of
// 2026-10-25 asked because `3/4 Pago` only draws its «De contado» state: at
// «Fiado o crédito» it shows *lo mismo que el asistente de venta*. It does,
// literally — `PagoCampos` is that component.
//
// ===========================================================================
// IT WRITES NOTHING. IT FILLS IN A DRAFT.
//
// The sitemap's arrow from «Pagar $00.00» points BACK at the order
// (`1564:11979`), not forward at a receipt — the sale is written three
// screens later, at «Registrar y finalizar». So what this collects lives in
// `sessionStorage` until then; see `lib/orders/borrador-de-registro.ts` for
// why that is safe and what is lost if the browser drops it.
//
// ===========================================================================
// THE FIELDS ARE THE SALE WIZARD'S, NOT A COPY OF THEM
//
// `PagoCampos` is the same component the «Registrar pago» sheet of
// `/ventas/nueva` mounts, extracted on 2026-10-24 precisely so this screen
// would not become a second copy of six hundred lines of money logic. The two
// chips, the amount in bolívares, the BCV-forecast checkbox and the
// equivalence all behave here exactly as they do there — including the
// owner's rule of 2026-10-18 that the chip is a consequence of the amount and
// not a field of its own.

export function OrderCurrencyPaymentForm({
  pedidoId,
  moneda,
  ownerId,
  lineas,
  rates,
  prevista,
  hrefCliente,
  hrefPedido,
  monedas,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  ownerId: string;
  // ── EL TOTAL SE CALCULA AQUÍ, NO LLEGA HECHO ──────────────────────
  //
  // Llegaba del servidor y por eso estaba MAL después de editar una línea:
  // el 2026-10-25 se midió un bloque cuya tarjeta decía «€17,52» con el
  // botón diciendo «Pagar €5,84» justo debajo. Y no era cosmético: este
  // número es el TECHO de lo que `PagoCampos` deja cobrar, así que el
  // tendero no habría podido cobrar una venta de 17,52.
  //
  // El servidor manda las líneas selladas; el borrador —que solo el
  // navegador ve— las corrige donde «Editar pedido» tocó algo. Es la misma
  // cuenta que `OrderTotalCard`, y por eso las dos leen lo mismo.
  lineas: { id: string; productId: string | null; cantidad: number; precioUnitario: number }[];
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  // La pantalla del cliente, con su ficha emparejada si la había.
  hrefCliente: string;
  hrefPedido: string;
  // Todas las monedas del pedido, para saber si esta era la última.
  monedas: string[];
}) {
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const borradorDeLineas = useBorrador(pedidoId);
  const total =
    Math.round(
      lineas.reduce((suma, l) => {
        if (l.productId == null) return suma;
        const edicion = borradorDeLineas?.editadas?.[l.id];
        if (edicion && String(edicion.currency) !== String(moneda)) return suma;
        // MISMA CUENTA QUE `OrderTotalCard`, incluido el precio de la
        // edición: este número es el TECHO de lo que se deja cobrar, así que
        // si se quedara con el precio sellado el tendero no podría cobrar la
        // venta que la pantalla de al lado le está enseñando.
        return (
          suma +
          (edicion?.quantity ?? l.cantidad) * (edicion?.unitPrice ?? l.precioUnitario)
        );
      }, 0) * 100,
    ) / 100;
  const router = useRouter();

  // THE DRAFT IS READ THROUGH `useSyncExternalStore`, the house pattern of
  // `abono-reparto.tsx` and `abono-monto.tsx`, and the two halves of it both
  // matter here.
  //
  // THE SERVER SNAPSHOT IS `null`, because `sessionStorage` does not exist
  // there. Reading it during render instead would make the first client paint
  // disagree with the server's HTML and React would throw the tree away —
  // with the amount field's value inside it.
  //
  // AND THE CLIENT SNAPSHOT IS CACHED IN A `ref`, because it must be the SAME
  // reference on every render: `leerPagoDeLinea` parses JSON and hands back a
  // fresh object each call, which React compares with `Object.is` and repaints
  // forever. Reading once on entry is also correct on its own terms — from
  // here on the fields own the value, and this screen is the only writer.
  const cache = useRef<PagoDeMoneda | null | undefined>(undefined);
  const inicial = useSyncExternalStore(
    leerUnaVezAlEntrar,
    () => {
      if (cache.current === undefined)
        cache.current = leerPagoDeMoneda(pedidoId, moneda);
      return cache.current;
    },
    () => null,
  );

  async function guardar(r: Registro) {
    fijarPagoDeMoneda(pedidoId, moneda, r);

    // ── EL ROMBO DEL SITEMAP, RESUELTO AQUÍ ──────────────────────────
    //
    // «¿Hay más de una moneda en el pedido?» --`1654:15724`-- y su respuesta
    // depende del BORRADOR, que solo el navegador ve. Tres salidas:
    const borrador = leerBorrador(pedidoId);
    const faltan = monedas.filter((m) => borrador?.monedas[m] == null);

    // 1. SIN CLIENTE TODAVÍA: la pantalla del cliente, que es el paso 4/4.
    if (!borrador?.cliente) {
      router.push(hrefCliente);
      return;
    }

    // 2. CON CLIENTE Y MONEDAS PENDIENTES: de vuelta al pedido, a por la
    //    siguiente. ESTE PASO NO VUELVE A PEDIR EL CLIENTE, que es la nota
    //    escrita encima de la flecha: *«el flujo pasa a ser de 4/4 pasos a
    //    3/3 porque la pantalla de Registrar cliente ya no se muestra porque
    //    registró el cliente en el primer pedido»*.
    if (faltan.length > 0) {
      router.push(hrefPedido);
      router.refresh();
      return;
    }

    // 3. ERA LA ÚLTIMA: se guarda todo. Aquí no hay más pantallas que pasar,
    //    así que pedir otra vez los datos del cliente solo para tener dónde
    //    poner el botón sería un paso de más -- justo el que el dueño mandó
    //    quitar al rediseñar esto.
    setCerrando(true);
    setError(null);
    const resultado = await registrarTodoElPedido(pedidoId, borrador, monedas);
    if (!resultado.ok) {
      setCerrando(false);
      setError(resultado.error);
      // SI ALGO LLEGÓ A GUARDARSE, la pantalla de detrás ya no es la misma:
      // dejarla vieja es cómo el tendero registra dos veces lo que ya está
      // escrito.
      if (resultado.monedasHechas.length > 0) router.refresh();
      return;
    }
    // EL BORRADOR SE BORRA SOLO DESPUÉS DE QUE LA VENTA ATERRICE.
    borrarBorrador();
    router.push(`/ventas/${resultado.primeraVentaId}`);
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <PagoCampos
        moneda={moneda}
        ownerId={ownerId}
        total={total}
        rates={rates}
        prevista={prevista}
        inicial={inicial}
        // «Total a pagar» YA ESTÁ ARRIBA, dibujado por la página como en el
        // frame. La tarjeta de total de los campos sería la misma cifra otra
        // vez.
        mostrarTotal={false}
        onGuardar={guardar}
        // THE FIGURE IS IN THE LABEL, as the frame writes it: «Pagar $00.00».
        // It is the BLOCK's total and not what is typed into the amount field —
        // the frame's own caption is the ceiling, which is what the shopkeeper
        // is confirming against.
        etiquetaBoton={
          cerrando
            ? "Registrando…"
            : `Pagar ${formatPriceAmount(total, moneda)}`
        }
      />
    </>
  );
}
