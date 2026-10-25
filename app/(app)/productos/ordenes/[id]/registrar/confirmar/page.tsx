import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { cargarBloque } from "@/lib/orders/cargar-bloque";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn } from "@/lib/products/price";

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
  const { pedido, bloque, rates, productosPorId, items } = await cargarBloque(
    id,
    moneda,
  );

  const totalEnBs =
    rates != null
      ? (priceIn("VES", { amount: bloque.total, currency: bloque.moneda }, rates)
          ?.amount ?? null)
      : null;

  const comentarioDe = new Map(items.map((i) => [i.id, i.comment]));

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}`}
        soloEnTelefono={false}
      />
      <ScreenTitle>Detalle del pedido</ScreenTitle>
      <p className="-mt-2 text-sm text-muted-foreground">2/4 Confirmar pedido</p>

      {/* «Total a pagar», el encabezado del frame. Es el total del BLOQUE, no
          el del pedido entero: lo que esta pantalla confirma es esta moneda. */}
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Total a pagar</p>
        <p className="text-2xl font-semibold tabular-nums">
          {formatPriceAmount(bloque.total, bloque.moneda)}
        </p>
        {totalEnBs != null ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatBs(totalEnBs)} hoy
          </p>
        ) : null}
      </div>

      {bloque.lineas.map((linea) => {
        const producto = linea.productId
          ? (productosPorId.get(linea.productId) ?? null)
          : null;
        const comentario = comentarioDe.get(linea.id) ?? null;
        // `stock_opening` ES LO QUE HAY: la columna se llama así y no `stock`.
        // El frame lo rotula «Disponible», que es lo que el tendero entiende.
        const stock = producto?.stock_opening ?? null;
        const porPagar =
          Math.round(linea.precioUnitario * linea.cantidad * 100) / 100;
        const enBs =
          rates != null
            ? (priceIn("VES", { amount: porPagar, currency: bloque.moneda }, rates)
                ?.amount ?? null)
            : null;

        return (
          <div key={linea.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-medium">{linea.nombre}</p>
                {producto == null ? (
                  // LA LÍNEA QUE NO VA A ENTRAR, dicha aquí y no al final. La
                  // decisión del dueño del 2026-10-24 es «se excluye esa línea
                  // y se avisa»; avisar tres pantallas después, cuando la
                  // venta ya está escrita, no es avisar.
                  <p className="text-sm text-destructive">
                    Este producto ya no está en tu catálogo, así que no entrará
                    en la venta.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Disponible: {stock == null ? "—" : formatCantidad(stock)}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Cantidad del pedido: {formatCantidad(linea.cantidad)}
                  {linea.cantidad !== linea.cantidadPedida ? (
                    // EL DUEÑO LO PIDIÓ ASÍ el 2026-10-24: *«el resumen final
                    // debe decir "el cliente pidió 5" y lo que se está
                    // registrando cuando difiera»*. Solo cuando difiere.
                    <span className="text-xs">
                      {" "}
                      (el cliente pidió {formatCantidad(linea.cantidadPedida)})
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">
                  {formatPriceAmount(porPagar, bloque.moneda)}
                </p>
                {enBs != null ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(enBs)} hoy
                  </p>
                ) : null}
              </div>
            </div>

            {comentario ? (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Comentarios del cliente
                </p>
                <p className="text-sm whitespace-pre-line">{comentario}</p>
              </div>
            ) : null}

            {producto != null ? (
              <Button variant="outline" size="sm" className="h-10 w-full" asChild>
                <Link
                  href={`/productos/ordenes/${pedido.id}/registrar/editar/${linea.id}?moneda=${bloque.moneda}`}
                >
                  Editar pedido
                </Link>
              </Button>
            ) : null}
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
