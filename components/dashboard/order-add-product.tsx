"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PasoProducto } from "@/components/dashboard/paso-producto";
import { OrderLineCard } from "@/components/dashboard/order-line-card";
import { OrderLineStepper } from "@/components/dashboard/order-line-stepper";
import { OrderLineEditSheet } from "@/components/dashboard/order-line-edit-sheet";
import { ImporteDeLinea } from "@/components/dashboard/order-line-figures";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { StockBadge } from "@/components/stock-badge";
import { agregarAlBloque, type LineaDelPedidoParaEditar } from "@/lib/orders/editar-linea";
import { lineasAgregadasEn, quitarLineaAgregada } from "@/lib/orders/borrador-de-registro";
import {
  productoParaVentaPorId,
  type ProductoParaVenta,
  type ProductosParaVenta,
} from "@/app/(app)/ventas/actions";
import {
  currencyName,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// «AGREGAR PRODUCTO» EN `1/3 Confirmar pedido`
//
// The owner's request of 2026-11-19: *«Al registrar un pedido, en el paso "1/3
// confirmar pedido" se debe mostrar el botón "Agregar producto" debajo del
// filled button "Confirmar y continuar", al seleccionarlo debe permitir
// seleccionar producto del catálogo o agregar uno nuevo (mismo patrón que
// Nueva venta 1/4 Producto)»*. Frames in section `2210:22223`, approved by him
// that day, with option A for the web (the two buttons stacked, as on the
// phone).
//
// WHAT HE DECIDED, and where each one lives:
//   · Only the sale changes, never the customer's order: the line lives in the
//     draft (`LineaAgregada`) and reaches the server only in
//     `registrarPedidoComoVenta`, which prices it from the catalogue.
//   · It enters in the block's currency (`monedaFija` below).
//   · A product already on a card of this block adds to that card
//     (`agregarAlBloque`).
//   · An added card has no «Cantidad del pedido» (`OrderAddedLines`).
// ═══════════════════════════════════════════════════════════════════════

type LineaDelBloque = { id: string; productId: string | null; cantidadPedida: number };

export function OrderAddProductButton({
  pedidoId,
  moneda,
  ownerId,
  umbralDeStock,
  lineasDelBloque,
  lineasDelPedido,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  ownerId: string;
  umbralDeStock: number;
  lineasDelBloque: LineaDelBloque[];
  lineasDelPedido: LineaDelPedidoParaEditar[];
}) {
  const [abierta, setAbierta] = useState(false);
  // THE GRID'S RESULTS, held here as the sale wizard holds them in its parent.
  // Kept across openings on purpose: the second «Agregar producto» opens on the
  // grid the shopkeeper last saw instead of an empty one that loads again.
  const [catalogo, setCatalogo] = useState<ProductosParaVenta | null>(null);

  return (
    <>
      {/* OUTLINE, 40 TALL, FULL WIDTH — `Botón outline · Agregar producto` in
          frame `2210:22299`. The same `Button` and the same `Plus` as «Agregar
          producto» inside the sheet, which is the sale's. */}
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full"
        onClick={() => setAbierta(true)}
      >
        <Plus className="size-5" aria-hidden="true" />
        Agregar producto
      </Button>

      {/* FULL WIDTH ON THE WEB, like every bottom sheet in the app. No frame
          draws this sheet on the web; asked on 2026-11-19, the owner kept it
          («Déjalo así»).

          MOUNTED ONLY WHILE OPEN: Radix leaves a closed dialog in the DOM, and
          this one carries the picker's search, its page and its chips. A sheet
          kept mounted would also keep its product sheet's `useState`. */}
      {abierta ? (
        <Sheet open onOpenChange={setAbierta}>
          <SheetContent
            side="bottom"
            className="max-h-[95svh] gap-0 overflow-y-auto rounded-t-3xl px-4 pb-6"
            // NO AUTOFOCUS. Radix focuses the first field on open, which is the
            // search box, and on a phone that raises the keyboard over the grid
            // the shopkeeper opened the sheet to look at. Seen in the browser
            // on 2026-11-19; the sale's own step is a page, not a sheet, so it
            // never had this.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="px-0 pt-5 pb-4">
              <SheetTitle className="text-xl font-normal">Agregar al pedido</SheetTitle>
              {/* «Entra en dólares, la moneda de este pedido.» — the frame's
                  own sentence. It is the one thing this sheet does differently
                  from the sale's, so it is said before the shopkeeper picks. */}
              <SheetDescription className="text-[13px]">
                Entra en {currencyName(moneda)}, la moneda de este pedido.
              </SheetDescription>
            </SheetHeader>
            <PasoProducto
              catalogo={catalogo}
              onCatalogo={setCatalogo}
              lineas={[]}
              ownerId={ownerId}
              umbralDeStock={umbralDeStock}
              monedaFija={moneda}
              pantalla="order_add_product"
              // NO EVENT HERE, ON PURPOSE: adding to the draft is a step, not a
              // record. How often orders grow is counted on the server, as
              // `added_lines` of `Order Currency Registered`, when the sale is
              // written (see `registrarElPedido`). The picker's own search and
              // chips still report, under `screen = order_add_product`.
              onAgregar={(linea) => {
                agregarAlBloque({
                  pedidoId,
                  moneda,
                  productId: linea.productId,
                  nombre: linea.name,
                  quantity: linea.quantity,
                  producto: linea.producto,
                  rates: catalogo?.rates ?? null,
                  lineasDelBloque,
                  lineasDelPedido,
                });
                setAbierta(false);
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// THE ADDED CARDS, AT THE END OF THE LIST — frame `2211:22439`
//
// Drawn by the browser because the draft is the browser's. Each card is the
// same `OrderLineCard` as an ordered line, with the same stock chip, stepper,
// amount and «Cambiar», and without «Cantidad del pedido».
//
// THE PRODUCT IS READ AGAIN ON ENTRY, with `productoParaVentaPorId`, the same
// read the server does for the ordered lines' «Cambiar». The draft holds only
// the id, the name and the quantity: the stock, the tiers and the photo have to
// be today's, and a draft that carried them would show a stock from whenever
// the product was added.
// ═══════════════════════════════════════════════════════════════════════
type Ficha = {
  p: ProductoParaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
};

export function OrderAddedLines({
  pedidoId,
  moneda,
  rates,
  umbralDeStock,
  lineasDelPedido,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  rates: BolivarRates | null;
  umbralDeStock: number;
  lineasDelPedido: LineaDelPedidoParaEditar[];
}) {
  const borrador = useBorrador(pedidoId);
  const agregadas = lineasAgregadasEn(borrador, moneda);
  const [fichas, setFichas] = useState<Record<string, Ficha | "sin-producto">>({});

  const faltan = agregadas
    .map((a) => a.productId)
    .filter((id, i, xs) => xs.indexOf(id) === i && fichas[id] === undefined)
    .join(",");
  useEffect(() => {
    if (faltan === "") return;
    let vivo = true;
    (async () => {
      const leidas: Record<string, Ficha | "sin-producto"> = {};
      for (const id of faltan.split(",")) {
        try {
          const r = await productoParaVentaPorId(id);
          const p = r.productos[0];
          leidas[id] = p
            ? { p, rates: r.rates, monedasDelLibro: r.monedasDelLibro }
            : "sin-producto";
        } catch (e) {
          // A dropped request leaves the card without its stepper and «Cambiar»
          // until the next visit; the line itself is still in the draft and in
          // the sale. Not marked «sin-producto», so the next render retries.
          console.error("[OrderAddedLines] product:", e);
        }
      }
      if (vivo) setFichas((f) => ({ ...f, ...leidas }));
    })();
    return () => {
      vivo = false;
    };
  }, [faltan]);

  if (agregadas.length === 0) return null;

  return (
    <>
      {agregadas.map((a) => {
        const ficha = fichas[a.productId];
        const leida = ficha && ficha !== "sin-producto" ? ficha : null;
        return (
          <OrderLineCard
            key={a.id}
            nombre={a.nombre}
            chip={
              leida ? <StockBadge quantity={leida.p.stock} threshold={umbralDeStock} /> : null
            }
            // THE PRODUCT WENT TO THE BIN AFTER IT WAS ADDED. The sale would
            // refuse it whole («Uno de los productos ya no está disponible»), so
            // the card says so here and the trash below takes it out.
            aviso={
              ficha === "sin-producto" ? (
                <p className="text-sm text-destructive">
                  Este producto ya no está en tu catálogo. Quítalo para poder registrar la venta.
                </p>
              ) : null
            }
            stepper={
              leida ? (
                <OrderLineStepper
                  pedidoId={pedidoId}
                  lineaId={a.id}
                  cantidadPedida={a.quantity}
                  moneda={moneda}
                  producto={leida.p.producto}
                  rates={leida.rates}
                  lineasDelPedido={lineasDelPedido}
                  // AN ADDED LINE CAN ALWAYS GO: the order's own lines stay.
                  sePuedeQuitar
                />
              ) : null
            }
            importe={
              <ImporteDeLinea
                pedidoId={pedidoId}
                lineaId={a.id}
                cantidadPedida={a.quantity}
                precioUnitario={a.unitPrice ?? 0}
                moneda={moneda}
                rates={rates}
                hayProducto={ficha !== "sin-producto"}
              />
            }
          >
            {leida ? (
              <OrderLineEditSheet
                umbralDeStock={umbralDeStock}
                pedidoId={pedidoId}
                lineaId={a.id}
                lineasDelPedido={lineasDelPedido}
                productId={leida.p.id}
                producto={leida.p.producto}
                nombre={leida.p.name}
                descripcion={leida.p.description}
                unidad={leida.p.unit}
                stock={leida.p.stock}
                foto={leida.p.photoPath || null}
                cantidad={a.quantity}
                moneda={moneda}
                rates={leida.rates}
                monedasDelLibro={leida.monedasDelLibro}
                // The currency it entered in stays on offer even if the product
                // does not enable it: opening «Cambiar» must not quietly move it.
                monedaExtra={moneda}
              />
            ) : null}
            {ficha === "sin-producto" ? (
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full"
                onClick={() => quitarLineaAgregada(pedidoId, a.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Quitar del pedido
              </Button>
            ) : null}
          </OrderLineCard>
        );
      })}
    </>
  );
}
