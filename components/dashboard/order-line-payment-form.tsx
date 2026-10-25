"use client";

import { useRouter } from "next/navigation";
import { useRef, useSyncExternalStore } from "react";
import { PagoCampos, type Registro } from "@/components/dashboard/pago-campos";
import {
  fijarPagoDeLinea,
  leerPagoDeLinea,
  type PagoDeLinea,
} from "@/lib/orders/borrador-de-registro";
import {
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// STEP 2/2 OF REGISTERING ONE ORDER LINE — frame `1564:11028`, «2/2 Abono».
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

export function OrderLinePaymentForm({
  pedidoId,
  lineaId,
  moneda,
  ownerId,
  total,
  rates,
  prevista,
}: {
  pedidoId: string;
  lineaId: string;
  moneda: PriceCurrency;
  ownerId: string;
  // What this line costs, which is the ceiling of what can be collected on it.
  total: number;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
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
  const cache = useRef<PagoDeLinea | null | undefined>(undefined);
  const inicial = useSyncExternalStore(
    sinSuscripcion,
    () => {
      if (cache.current === undefined)
        cache.current = leerPagoDeLinea(pedidoId, lineaId);
      return cache.current;
    },
    () => null,
  );

  function guardar(r: Registro) {
    fijarPagoDeLinea(pedidoId, lineaId, r);
    // BACK TO THE ORDER, which is where the sitemap's arrow goes. `refresh()`
    // so the order's screen re-reads its lines: this one now has a payment
    // and must stop offering «Registrar».
    router.push(`/productos/ordenes/${pedidoId}`);
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
      // THE SEALED LINE IS ALREADY ABOVE, drawn by the page from the frame.
      // The fields' own total card would be the same figure a second time.
      mostrarTotal={false}
      onGuardar={guardar}
      // THE FIGURE IS IN THE LABEL, as the frame writes it: «Pagar $00.00».
      // It is the line's total and not what is typed into the amount field —
      // the frame's own caption is the ceiling, which is what the shopkeeper
      // is confirming against.
      etiquetaBoton={`Pagar ${formatPriceAmount(total, moneda)}`}
    />
  );
}
