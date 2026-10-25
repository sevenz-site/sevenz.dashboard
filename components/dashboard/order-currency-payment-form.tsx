"use client";

import { useRouter } from "next/navigation";
import { useRef, useSyncExternalStore } from "react";
import { PagoCampos, type Registro } from "@/components/dashboard/pago-campos";
import {
  fijarPagoDeMoneda,
  leerPagoDeMoneda,
  type PagoDeMoneda,
} from "@/lib/orders/borrador-de-registro";
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

// No subscription: the draft does not change while this screen is alive. The
// only writer is this screen's own «Pagar», and that navigates away.
const sinSuscripcion = () => () => {};

export function OrderCurrencyPaymentForm({
  pedidoId,
  moneda,
  ownerId,
  total,
  rates,
  prevista,
  href,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  ownerId: string;
  // What this currency block costs, which is the ceiling of what can be
  // collected on it.
  total: number;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  // Adónde lleva «Pagar», decidido por la página: la ficha del cliente si
  // todavía no se ha rellenado, o el pedido si quedan monedas.
  href: string;
}) {
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
    sinSuscripcion,
    () => {
      if (cache.current === undefined)
        cache.current = leerPagoDeMoneda(pedidoId, moneda);
      return cache.current;
    },
    () => null,
  );

  function guardar(r: Registro) {
    fijarPagoDeMoneda(pedidoId, moneda, r);
    // WHERE «Pagar» GOES IS THE ROMBO OF THE SITEMAP: «¿Hay más de una moneda
    // en el pedido?». The page works out the answer — it is the only one that
    // has read the order's lines — and hands it over as `href`, so this
    // component never has to guess.
    router.push(href);
    router.refresh();
  }

  return (
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
      etiquetaBoton={`Pagar ${formatPriceAmount(total, moneda)}`}
    />
  );
}
