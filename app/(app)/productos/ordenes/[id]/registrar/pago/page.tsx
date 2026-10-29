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

  // ── LAS FICHAS EMPAREJADAS, CON LO QUE HACE FALTA PARA AVISAR ────────
  //
  // Encargo del dueno el 2026-10-28: al marcar «Fiado o credito» con una
  // ficha de mala paga, sale un aviso sobre el boton diciendo CUANDO se
  // marco y CUANTO debe. Las dos cifras hay que traerlas aqui:
  //
  //   · La FECHA sale de `client_flags`, no de `clients`. Esa tabla solo
  //     guarda el booleano `is_flagged`, que contesta «ahora mismo» y no
  //     «desde cuando» -- lo dice la propia 038. La fila que vale es la
  //     ultima SIN levantar (`unflagged_at is null`): un cliente marcado,
  //     perdonado y vuelto a marcar tiene varias.
  //
  //   · La DEUDA sale de `client_summary`, y se toma la del LIBRO DE ESTA
  //     PANTALLA. Es lo unico defendible: el aviso acompana a un cobro en
  //     una moneda concreta, y sumar libros esta prohibido en esta app.
  //     Si debe tambien en otro, eso no es lo que se esta cobrando aqui.
  const emparejadas =
    coincidencia.kind === "uno"
      ? [coincidencia.cliente]
      : coincidencia.kind === "varios"
        ? coincidencia.clientes
        : [];
  const idsMarcados = emparejadas.filter((c) => c.is_flagged).map((c) => c.id);

  // Solo si hay alguna marcada: sin marcas no hay nada que avisar y estas dos
  // consultas no tendrian a quien describir.
  const [resMarcas, resSaldos] = idsMarcados.length
    ? await Promise.all([
        supabase
          .from("client_flags")
          .select("client_id, flagged_at")
          .in("client_id", idsMarcados)
          .is("unflagged_at", null)
          .order("flagged_at", { ascending: false }),
        supabase
          .from("client_summary")
          .select("client_id, balance, balance_usd, balance_eur")
          .in("client_id", idsMarcados),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  // SE MIRA EL ERROR. Descartarlo dejaria el aviso sin fecha y sin deuda sin
  // que nada lo delatara -- que es el fallo que ya costo un dia entero en
  // Reportes el 2026-10-27. Aqui ademas no se tumba la pantalla: un aviso
  // incompleto es mejor que no poder cobrar, y el dialogo de mala paga sigue
  // saliendo igual porque no depende de esto.
  if (resMarcas.error) console.error("[pago] client_flags", resMarcas.error);
  if (resSaldos.error) console.error("[pago] client_summary", resSaldos.error);

  // La PRIMERA de cada cliente, que por el `order by` de arriba es la mas
  // reciente sin levantar.
  const marcaDe = new Map<string, string>();
  for (const f of resMarcas.data ?? []) {
    if (!marcaDe.has(f.client_id as string)) {
      marcaDe.set(f.client_id as string, f.flagged_at as string);
    }
  }
  const saldoDe = new Map<string, number>();
  for (const r of resSaldos.data ?? []) {
    // `bloque.moneda` Y NO EL `moneda` DE LA URL: aquel es el parametro
    // crudo --puede venir vacio-- y el libro de verdad lo resuelve
    // `cargarBloque`. Confundirlos daria el saldo colombiano a un negocio
    // venezolano cada vez que se entra sin `?moneda=`.
    const v =
      bloque.moneda === "USD"
        ? r.balance_usd
        : bloque.moneda === "EUR"
          ? r.balance_eur
          : r.balance;
    saldoDe.set(r.client_id as string, Number(v ?? 0));
  }

  const fichas = emparejadas.map((c) => ({
    id: c.id,
    name: c.name,
    marcada: c.is_flagged,
    // `null` cuando la marca es anterior a `client_flags` (migracion 022) o
    // la fila falta: el aviso sale sin fecha en vez de inventarse una.
    marcadaEl: marcaDe.get(c.id) ?? null,
    // Lo que debe EN EL LIBRO DE ESTA PANTALLA. Cero y negativo --saldo a
    // favor-- se tratan igual aguas abajo: no se escribe la frase de la deuda.
    debe: saldoDe.get(c.id) ?? 0,
  }));


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
        // TODAS las emparejadas, no la primera: con varias, cuál se usa lo
        // decide el borrador, y eso solo lo sabe el navegador. Ver `PR-E3`.
        fichas={fichas}
      />
    </div>
  );
}
