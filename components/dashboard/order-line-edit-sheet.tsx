"use client";

import { useState } from "react";
import { StockBadge } from "@/components/stock-badge";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronRight, ImageOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OrderLineEditForm } from "@/components/dashboard/order-line-edit-form";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import type { ProductoPublico } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// «EDITAR PEDIDO» ABRE UNA HOJA — frame `1652:13588` («Nuevo registro -
// detalle producto»), leído con el puente de escritorio el 2026-10-25.
//
// ===========================================================================
// POR QUÉ UNA HOJA Y NO LA PANTALLA QUE HABÍA
//
// Petición del dueño el 2026-10-25: *«cuando selecciono "Editar pedido" debe
// ser en componente sheet»*, con el frame delante. Y el frame lo dice por su
// cuenta: su cabecera es «Detalle del producto» con una **X**, no una flecha
// de volver. Una X cierra algo que está encima; una flecha deshace una
// navegación. Son dos promesas distintas sobre dónde estás.
//
// LO QUE SE GANA es lo mismo que en «Ver ‹cliente›»: el paso 2/4 sigue
// montado detrás. Editar una línea es un paréntesis dentro de confirmar el
// pedido, no salir de él.
//
// ===========================================================================
// LA RUTA `/registrar/editar/[itemId]` SE QUEDA, Y NO ES OLVIDO
//
// Nadie la enlaza ya, pero existe y funciona: es a donde lleva un enlace
// viejo, una pestaña abierta antes del cambio o el botón de atrás de alguien
// que estaba a mitad. Borrarla convertiría eso en un 404 a cambio de nada.
export function OrderLineEditSheet({
  pedidoId,
  lineaId,
  lineasDelPedido,
  productId,
  producto,
  nombre,
  descripcion,
  unidad,
  stock,
  foto,
  cantidad,
  moneda,
  rates,
  monedasDelLibro,
  umbralDeStock,
}: {
  pedidoId: string;
  lineaId: string;
  lineasDelPedido: { id: string; moneda: string }[];
  /** `owners.low_stock_threshold`. Llega de la pantalla y no se lee aquí: esta hoja es cliente, y el dato es del servidor. */
  umbralDeStock: number;
  productId: string;
  producto: ProductoPublico;
  nombre: string;
  descripcion: string | null;
  unidad: string | null;
  stock: number | null;
  foto: string | null;
  cantidad: number;
  moneda: PriceCurrency;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
}) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);

  // ── ABRE CON LO QUE YA ESTÁ PUESTO, NO CON LO QUE PIDIÓ EL CLIENTE ──
  //
  // `cantidad` y `moneda` llegan del SERVIDOR, o sea de `catalog_order_items`:
  // lo que el cliente encargó. Pero si el tendero ya editó esta línea, lo que
  // vale es su edición, y vive en el borrador --que el servidor no ve--.
  //
  // QUÉ COSTÓ, el 2026-10-26: el dueño puso 4, dio a «Agregar», volvió a
  // abrir la hoja y le salía 1 otra vez. *«el sheet "Editar pedido" abre con
  // el número original del pedido "1"»*. La edición estaba guardada; la hoja
  // no la leía, así que cada vez que la abría parecía que se había perdido —
  // y el siguiente «Agregar» la habría pisado con el número viejo.
  const borrador = useBorrador(pedidoId);
  const edicion = borrador?.editadas?.[lineaId];
  const cantidadActual = edicion?.quantity ?? cantidad;
  // La moneda a la que el tendero la movió, si la movió. `moneda` sigue
  // siendo la del BLOQUE en el que estamos, y `OrderLineEditForm` la necesita
  // aparte para saber si al guardar hay que navegar a otro bloque.
  const monedaActual = (edicion?.currency as PriceCurrency | undefined) ?? moneda;

  return (
    <>
      {/* ── «CAMBIAR», NO «EDITAR PEDIDO» — frame `1389:8388` ─────────
          Pedido por el dueno el 2026-10-28: la cantidad pasa a cambiarse con
          «−» y «+» en la propia fila, asi que este boton ya no es la puerta
          a editar la linea: es solo lo que queda detras -- la moneda, el
          escalon y la ficha del producto.
          Un boton de ancho completo que dijera «Editar pedido» al lado de un
          «+» que ya edita el pedido serian dos promesas para una cosa. El
          frame lo dibuja como un boton de TEXTO con su chevron, en la fila
          del subtotal. */}
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className="-mr-1 flex shrink-0 items-center gap-1 rounded-md px-1 py-1.5 text-sm outline-none transition-colors active:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cambiar
        <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
      </button>

      <Sheet open={abierta} onOpenChange={setAbierta}>
        {/* `p-0` Y EL PROPIO RELLENO DENTRO, porque la foto llega a los dos
            bordes como en el frame. Es el mismo trato que `ProductSheet` ya
            le da a su imagen. */}
        <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto p-0">
          <SheetHeader className="px-4 py-5">
            {/* «EDITAR PEDIDO», por decisión del dueño el 2026-10-25. El
                frame `1652:13588` lo rotula «Detalle del producto» y él lo
                cambió al verlo montado: desde el paso 2/4 esta hoja no es
                para mirar un producto, es para cambiar cuánto se lleva. El
                rótulo del frame y la decisión de hoy quedan los dos escritos;
                manda la de hoy. */}
            <SheetTitle className="text-base font-medium">
              Editar pedido
            </SheetTitle>
          </SheetHeader>

          <div className="h-[200px] w-full bg-muted">
            {foto ? (
              <Image
                src={foto}
                alt=""
                width={1200}
                height={800}
                unoptimized
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-8" aria-hidden />
              </div>
            )}
          </div>

          {/* `pb-0` Y NO `p-4`: la fila de abajo de `ProductDetail` trae su
              propio aire de 40px. Sumarle los 16 de aquí deja el botón a 56
              del filo, que es lo que se midió antes de poner esto. Es el
              mismo descuadre que `app-main.tsx` documenta para las pantallas
              con `StickyActions`. */}
          <div className="flex flex-col gap-4 px-4 pt-4 pb-0">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-2xl font-normal">{nombre}</h2>
              {/* MISMO CHIP QUE LA TARJETA QUE ABRE ESTA HOJA, ahora de
                  verdad: hasta el 2026-10-29 eran dos pastillas escritas por
                  separado que coincidían por casualidad. */}
              <StockBadge quantity={stock} threshold={umbralDeStock} />
              {unidad ? (
                <p className="text-xs text-muted-foreground">{unidad}</p>
              ) : null}
            </div>

            {/* El frame la dibuja llena; en la base es opcional, así que la
                etiqueta se esconde en vez de quedarse colgando sobre nada. */}
            {descripcion ? (
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">
                  Descripción del producto
                </p>
                <p className="text-sm leading-relaxed">{descripcion}</p>
              </div>
            ) : null}

            <OrderLineEditForm
              pedidoId={pedidoId}
              lineasDelPedido={lineasDelPedido}
              lineaId={lineaId}
              productId={productId}
              producto={producto}
              cantidad={cantidadActual}
              moneda={moneda}
              monedaInicial={monedaActual}
              rates={rates}
              stock={stock}
              monedasDelLibro={monedasDelLibro}
              // CIERRA LA HOJA Y REFRESCA LO DE DETRÁS. El paso 2/4 lo pinta
              // el servidor a partir de las líneas del pedido, así que sin
              // `refresh()` la tarjeta de atrás seguiría con la cantidad
              // vieja aunque el borrador ya tenga la nueva.
              alTerminar={(monedaNueva) => {
                setAbierta(false);
                if (monedaNueva) {
                  // La línea se fue a otro bloque: el de aquí ya no la tiene,
                  // así que se lleva al tendero donde sí está.
                  router.push(
                    `/productos/ordenes/${pedidoId}/registrar/confirmar?moneda=${monedaNueva}`,
                  );
                  return;
                }
                router.refresh();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
