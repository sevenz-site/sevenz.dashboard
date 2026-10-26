import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { OrderCurrencyPaymentForm } from "@/components/dashboard/order-currency-payment-form";
import { OrderStepCounter } from "@/components/dashboard/order-step-counter";
import { cargarBloque } from "@/lib/orders/cargar-bloque";
import { unicaMonedaDelPedido } from "@/lib/orders/pasos-del-registro";
import { OrderTotalCard } from "@/components/dashboard/order-total-card";
import { findOrderClient } from "@/lib/orders/order-client-match";
import { createClient } from "@/lib/supabase/server";
import type { PriceCurrency } from "@/lib/products/price";

// STEP `3/4 Pago` — frame `1653:12718`, read with the desktop bridge on
// 2026-10-25.
//
// ===========================================================================
// THE AMOUNT, THE TERM AND THE INSTALMENTS, ONCE PER CURRENCY
//
// This is what `CT-147` fixes. Asking per line asked for the TERM per line,
// and `registrarVenta`'s credit has always been per currency, so one of two
// terms was dropped on the way in — silently, leaving the app with a deadline
// the shopkeeper never agreed to.
//
// ===========================================================================
// WHERE «Pagar» GOES IS THE SITEMAP'S DIAMOND
//
// `1654:15724`: «¿Hay más de una moneda en el pedido?». SÍ goes to the client
// screen and then back to the order for the next block; NO goes to the client
// screen to finish. Either way the next stop is the client — what changes is
// the label there, and the arrow says so: *«CTA es "Registrar y finalizar"
// porque no hay más pedidos que registrar»*.
//
// ONE EXCEPTION, AND IT IS THE SECOND PASS: once the client has been filled
// in, its screen is skipped — the arrow's own note, *«el flujo pasa a ser de
// 4/4 pasos a 3/3 porque la pantalla de Registrar cliente ya no se muestra
// porque registró el cliente en el primer pedido»*. The browser is the only
// one who knows whether the draft already has a client, so that branch is
// taken there; this page hands over the destination for the case it can
// decide, which is the one that needs the ficha looked up.
export default async function PagoDeBloquePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moneda?: string }>;
}) {
  const { id } = await params;
  const { moneda } = await searchParams;
  const { pedido, bloque, bloques, rates, prevista, ownerId, quitadas, items } =
    await cargarBloque(id, moneda);

  // LA FICHA QUE YA EXISTE, buscada por DOCUMENTO. Es lo que decide si la
  // pantalla del cliente llega con sus datos ya puestos o en blanco, y se
  // resuelve aquí porque la siguiente pantalla no debe volver a consultarlo.
  const supabase = await createClient();
  const coincidencia = await findOrderClient(
    supabase,
    ownerId,
    pedido.customer_document,
    pedido.customer_document_type,
  );
  const ficha = coincidencia.kind === "uno" ? coincidencia.cliente.id : null;


  const hrefCliente = `/productos/ordenes/${pedido.id}/registrar/cliente?moneda=${bloque.moneda}${ficha ? `&ficha=${ficha}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      {/* ATRÁS AL PASO 2/4 y no al pedido: es de donde viene el tendero, y
          volver un paso es lo que promete un contador «2/4 · 3/4». */}
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}/registrar/confirmar?moneda=${bloque.moneda}`}
        soloEnTelefono={false}
      />
      <ScreenTitle>Registrar pago</ScreenTitle>
      <OrderStepCounter
        pedidoId={pedido.id}
        paso="pago"
        sinPasoDePedido={unicaMonedaDelPedido(bloques, quitadas.size > 0) != null}
      />

      <OrderTotalCard
        pedidoId={pedido.id}
        lineas={bloque.lineas.map((l) => ({
          id: l.id,
          productId: l.productId,
          cantidad: l.cantidadPedida,
          precioUnitario: l.precioUnitario,
        }))}
        moneda={bloque.moneda}
        rates={rates}
      />

      <OrderCurrencyPaymentForm
        pedidoId={pedido.id}
        moneda={bloque.moneda}
        ownerId={ownerId}
        lineas={bloque.lineas.map((l) => ({
          id: l.id,
          productId: l.productId,
          cantidad: l.cantidadPedida,
          precioUnitario: l.precioUnitario,
        }))}
        rates={rates}
        prevista={prevista}
        hrefCliente={hrefCliente}
        hrefPedido={`/productos/ordenes/${pedido.id}/registrar`}
        // TODAS las monedas del pedido, para saber si esta era la última.
        monedas={bloques.map((b) => b.moneda)}
        // ── Y TODAS SUS LÍNEAS, para el aviso de «mala paga» ──────────
        //
        // Esta pantalla escribe la venta cuando esta era la última moneda y el
        // cliente ya estaba puesto, así que necesita saber si el pedido ENTERO
        // deja algo debiendo -- no solo su bloque. Sin las descatalogadas, que
        // no se cobran.
        lineasDelPedido={items
          .filter((i) => i.product_id != null)
          .map((i) => ({
            id: i.id,
            cantidad: Number(i.quantity),
            precioUnitario: Number(i.unit_price),
            moneda: i.currency as PriceCurrency,
          }))}
        ficha={
          coincidencia.kind === "uno"
            ? {
                id: coincidencia.cliente.id,
                name: coincidencia.cliente.name,
                marcada: coincidencia.cliente.is_flagged,
              }
            : null
        }
      />
    </div>
  );
}
