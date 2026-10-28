import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { OrderStepCounter } from "@/components/dashboard/order-step-counter";
import { cargarBloque } from "@/lib/orders/cargar-bloque";
import { unicaMonedaDelPedido } from "@/lib/orders/pasos-del-registro";
import { OrderTotalCard } from "@/components/dashboard/order-total-card";
import {
  CantidadDeLinea,
  ImporteDeLinea,
} from "@/components/dashboard/order-line-figures";
import { OrderLineEditSheet } from "@/components/dashboard/order-line-edit-sheet";
import { OrderLineStepper } from "@/components/dashboard/order-line-stepper";
import { productoParaVentaPorId } from "@/app/(app)/ventas/actions";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatCantidad } from "@/lib/products/cantidad";

// STEP `2/4 Confirmar pedido` — frame `1652:12831`, read with the desktop
// bridge on 2026-10-25.
//
// ===========================================================================
// IT CONFIRMS A CURRENCY BLOCK, NOT A PRODUCT
//
// This screen used to be «1/2 Confirma producto» and showed ONE line. `CT-147`
// made the currency the unit of work — the owner: *«el registro/pago debería
// hacerse por moneda no por producto para así acortar el proceso de
// registro»* — so it now lists everything the customer ordered in this
// currency, with its total at the top, and one «Editar pedido» per line.
//
// ===========================================================================
// WHAT IS SEALED AND WHAT IS READ TODAY
//
// The owner's decision of 2026-10-17, unchanged by the redesign: quantity,
// unit price and tier are what the customer agreed to and never move;
// description, photo and STOCK are read to decide whether to fulfil it, so a
// frozen stock from last Tuesday would help nobody.
//
// AND THE STOCK WARNS WITHOUT BLOCKING, his instruction of 2026-10-24: *«está
// bien que avise pero no debe bloquear la venta porque el stock puede no
// estar actualizado pero sí podría tener el producto en la bodega»*.
export default async function ConfirmarBloquePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moneda?: string }>;
}) {
  const { id } = await params;
  const { moneda } = await searchParams;
  const { pedido, bloque, bloques, rates, productosPorId, items, quitadas } =
    await cargarBloque(id, moneda);


  const comentarioDe = new Map(items.map((i) => [i.id, i.comment]));

  // ── LO QUE LA HOJA DE «EDITAR PEDIDO» NECESITA ──────────────────────
  //
  // `productoParaVentaPorId` es lo que la pantalla de editar cargaba cuando
  // era una ruta; al pasar a hoja (petición del dueño el 2026-10-25) el
  // trabajo del servidor se hace aquí, una vez por línea viva de este bloque.
  //
  // EN PARALELO Y NO EN SERIE: un bloque de tres productos serían tres viajes
  // encadenados justo antes de pintar, y esto es la pantalla que el tendero
  // mira con el cliente delante.
  //
  // SOLO LAS LÍNEAS CON PRODUCTO: una descatalogada no se puede editar, y su
  // tarjeta ya dice por qué no entra en la venta.
  const lineasVivas = bloque.lineas.filter((l) => l.productId != null);
  const edicionDe = new Map(
    (
      await Promise.all(
        lineasVivas.map(async (l) => {
          const { productos, rates: r, monedasDelLibro } = await productoParaVentaPorId(
            l.productId as string,
          );
          const p = productos[0];
          return p ? ([l.id, { p, rates: r, monedasDelLibro }] as const) : null;
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => x != null),
  );

  // TODAS las líneas del pedido con su moneda sellada: `fijarLineaEditada`
  // las exige para limpiar el abono de un bloque que la edición deje vacío.
  const lineasDelPedido = items.map((i) => ({
    id: i.id,
    moneda: String(i.currency ?? ""),
  }));

  // ¿ES ESTA LA PRIMERA PANTALLA DEL FLUJO? Decide la flecha de atrás y el
  // contador, y las dos tienen que contestar igual que `/registrar`, que es
  // quien redirige hasta aquí. Por eso las tres preguntan a la misma función.
  const unicaMoneda = unicaMonedaDelPedido(bloques, quitadas.size > 0);

  return (
    // `flex-1` NO SOBRA: `StickyActions` baja con `mt-auto`, y `mt-auto` solo
    // empuja si el contenedor tiene alto que repartir. Sin esto la barra se
    // quedaba pegada al contenido —con media pantalla vacía debajo— que es lo
    // que el dueño reportó el 2026-10-25 con la captura del paso 2/4.
    <div className="flex flex-1 flex-col gap-4">
      {/* ATRÁS AL DETALLE CUANDO ESTA ES LA PRIMERA PANTALLA DEL FLUJO.
          Con una sola moneda el `1/4` no existe --encargo del dueño del
          2026-10-25-- y apuntar ahí mandaría al tendero a una pantalla que
          redirige de vuelta aquí: la flecha de atrás dejaría de retroceder. */}
      <ScreenBackRow
        href={
          unicaMoneda
            ? `/productos/ordenes/${pedido.id}`
            : `/productos/ordenes/${pedido.id}/registrar`
        }
        soloEnTelefono={false}
      />
      <ScreenTitle>Detalle del pedido</ScreenTitle>
      <OrderStepCounter
        pedidoId={pedido.id}
        paso="confirmar"
        sinPasoDePedido={unicaMoneda != null}
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

      {bloque.lineas.map((linea) => {
        const producto = linea.productId
          ? (productosPorId.get(linea.productId) ?? null)
          : null;
        const comentario = comentarioDe.get(linea.id) ?? null;
        // `stock_opening` ES LO QUE HAY: la columna se llama así y no `stock`.
        // El frame lo rotula «Disponible», que es lo que el tendero entiende.
        const stock = producto?.stock_opening ?? null;

        return (
          <div key={linea.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                {/* ── EL NOMBRE Y EL STOCK, EN LA MISMA FILA ──────────────
                    El frame dibuja un «Product Header» con el nombre y, a su
                    lado, un `chip_info` que dice «Disponible: 00». Aquí el
                    stock era una línea de texto suelta debajo, y el dueño lo
                    reportó el 2026-10-26 con la captura.

                    ES EL MISMO CHIP QUE LA HOJA «Editar pedido», no uno
                    nuevo: es el mismo dato del mismo producto a un toque de
                    distancia, y dos dibujos distintos de la misma cifra se
                    leen como dos cifras.

                    SIN STOCK NO HAY CHIP. `stock_opening` es nulo en un
                    producto que no lo lleva, y un chip que dijera
                    «Disponible: —» afirma que se midió y salió vacío. */}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{linea.nombre}</p>
                  {producto != null && stock != null ? (
                    <span className="w-fit rounded-full bg-money-in/10 px-1.5 text-xs text-money-in">
                      Disponible: {formatCantidad(stock)}
                    </span>
                  ) : null}
                </div>
                {producto == null ? (
                  // LA LÍNEA QUE NO VA A ENTRAR, dicha aquí y no al final. La
                  // decisión del dueño del 2026-10-24 es «se excluye esa línea
                  // y se avisa»; avisar tres pantallas después, cuando la
                  // venta ya está escrita, no es avisar.
                  <p className="text-sm text-destructive">
                    Este producto ya no está en tu catálogo, así que no entrará
                    en la venta.
                  </p>
                ) : null}
                <CantidadDeLinea
                  pedidoId={pedido.id}
                  lineaId={linea.id}
                  cantidadPedida={linea.cantidadPedida}
                />
                {/* ── «−» Y «+» DEBAJO DEL NOMBRE — frame `1389:8388` ────
                    Encargo del dueno el 2026-10-28.

                    EN SU PROPIA FILA Y NO AL LADO DEL IMPORTE, que fue mi
                    primer intento y se vio en pantalla: las tres cajas miden
                    128px, y con el nombre y el importe en la misma fila a
                    375px el nombre se partia en dos lineas y la columna de la
                    izquierda quedaba estrujada. El frame ya lo resuelve asi
                    -- su fila de arriba lleva foto, nombre y stepper, y el
                    importe baja a la fila del subtotal.

                    SOLO SI EL PRODUCTO SIGUE EN EL CATALOGO: sin el no hay
                    precio con el que recalcular, y esa linea ya dice en rojo
                    que no entra en la venta. */}
                {edicionDe.get(linea.id) ? (
                  <div className="pt-2">
                    <OrderLineStepper
                      pedidoId={pedido.id}
                      lineaId={linea.id}
                      cantidadPedida={linea.cantidadPedida}
                      moneda={bloque.moneda}
                      producto={edicionDe.get(linea.id)!.p.producto}
                      rates={edicionDe.get(linea.id)!.rates}
                      lineasDelPedido={lineasDelPedido}
                    />
                  </div>
                ) : null}
              </div>
              <ImporteDeLinea
                pedidoId={pedido.id}
                lineaId={linea.id}
                cantidadPedida={linea.cantidadPedida}
                precioUnitario={linea.precioUnitario}
                moneda={bloque.moneda}
                rates={rates}
                hayProducto={producto != null}
              />
            </div>

            {comentario ? (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Comentarios del cliente
                </p>
                <p className="text-sm whitespace-pre-line">{comentario}</p>
              </div>
            ) : null}

            {(() => {
              const edicion = edicionDe.get(linea.id);
              if (!edicion) return null;
              return (
                <OrderLineEditSheet
                  pedidoId={pedido.id}
                  lineaId={linea.id}
                  lineasDelPedido={lineasDelPedido}
                  productId={edicion.p.id}
                  producto={edicion.p.producto}
                  nombre={edicion.p.name}
                  descripcion={edicion.p.description}
                  unidad={edicion.p.unit}
                  stock={edicion.p.stock}
                  foto={
                    edicion.p.photoPath
                      ? getPublicProductPhotoUrl(edicion.p.photoPath)
                      : null
                  }
                  cantidad={linea.cantidad}
                  moneda={bloque.moneda}
                  rates={edicion.rates}
                  monedasDelLibro={edicion.monedasDelLibro}
                />
              );
            })()}
          </div>
        );
      })}

      {/* PEGADO ABAJO Y DENTRO DE `StickyActions`, que es la regla de
          `CLAUDE.md` que el dueño ha tenido que pedir tres veces: con el
          teclado arriba no queda nada pegado al borde de abajo. Aquí no hay
          campos, pero el componente es el mismo para todo el flujo y copiar
          sus clases a mano es justo cómo se rompió la segunda vez. */}
      <StickyActions>
        <Button className="h-10 w-full" asChild>
          <Link
            href={`/productos/ordenes/${pedido.id}/registrar/pago?moneda=${bloque.moneda}`}
          >
            Confirmar y continuar
          </Link>
        </Button>
      </StickyActions>
    </div>
  );
}
