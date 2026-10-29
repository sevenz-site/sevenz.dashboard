import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { ImageOff } from "lucide-react";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { OrderLineEditForm } from "@/components/dashboard/order-line-edit-form";
import { productoParaVentaPorId } from "@/app/(app)/ventas/actions";
import { createClient } from "@/lib/supabase/server";
import { StockBadge } from "@/components/stock-badge";
import { loadLowStockThreshold } from "@/lib/products/low-stock-threshold";
import type { PriceCurrency } from "@/lib/products/price";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  estaDescartado,
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// «1/2 EDITA PRODUCTO» — frame `1566:13300`, reached from «Editar» on an order
// line. Its own arrow in the sitemap, labelled «Selecicona "Editar"».
//
// ===========================================================================
// IT WAS POINTING AT THE CATALOGUE AND THAT WAS WRONG
//
// Until 2026-10-24 «Editar» linked to `/productos/<id>`, the catalogue entry.
// It was a guess, made without reading the sitemap's arrows, and the arrow
// says this instead: the same two-step wizard, on its editing step. The
// difference matters — the catalogue entry changes the product for every
// future order; this changes one line of one order.
//
// EVERY GUARD OF THE OTHER STEPS IS REPEATED, for the same reason: this URL
// can be typed or reached by the back button long after anything was decided
// on another screen.
export default async function EditarLineaPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  if (error) console.error("[orders] editar linea:", error.message);
  if (!order) notFound();

  // El umbral del aviso de existencias, para el chip de debajo del nombre.
  // Va DESPUÉS del `notFound`: una pantalla que no se va a pintar no tiene por
  // qué pagar una consulta.
  const umbralDeStock = await loadLowStockThreshold(supabase, user!.id);
  const pedido = order as CatalogOrderRow;

  // THE HARD STOP: an order that is already a sale cannot be walked again.
  // Ni uno descartado, desde el 2026-10-26: editar una línea de un pedido que
  // no va a ninguna parte no tiene nada que escribir.
  if (
    pedido.registered_at != null ||
    pedido.sale_id != null ||
    estaDescartado(pedido)
  ) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  // TODAS las líneas de una vez: hace falta la que se edita Y el resto, para
  // poder decirle al borrador qué bloques de moneda quedan vivos después del
  // cambio. Dos consultas serían dos verdades que se pueden separar.
  const { data: filas, error: errorItem } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    // SOLO LAS VIVAS -- migración `161`. Esta ruta vieja sigue existiendo
    // para un enlace antiguo, y editar una línea quitada no tiene sentido.
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  const todasLasLineas = (filas ?? []) as CatalogOrderItemRow[];
  const itemRow = todasLasLineas.find((l) => l.id === itemId) ?? null;

  if (errorItem) console.error("[orders] editar linea item:", errorItem.message);
  if (!itemRow) notFound();
  const linea = itemRow as CatalogOrderItemRow;

  // NO PRODUCT, NOTHING TO EDIT. `product_id` is `on delete set null`, so a
  // deleted product leaves the line intact and unopenable here. The order's
  // card already hides «Editar» in that case; this is the same answer for
  // anyone who reaches the URL another way.
  if (!linea.product_id) notFound();

  // THROUGH THE SALE'S OWN LOADER, not a query of this page's own. It is what
  // puts the product into `ProductoPublico` — the shape the customer saw —
  // and `app/(app)/ventas/actions.ts` explains at length why the counter and
  // the catalogue must price from the same function.
  const { productos, rates, monedasDelLibro } = await productoParaVentaPorId(linea.product_id);
  const producto = productos[0];
  if (!producto) notFound();

  const foto = producto.photoPath ? getPublicProductPhotoUrl(producto.photoPath) : null;

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}`}
        label="Volver al pedido"
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        {/* «NUEVA VENTA», which is what the frame's title says. It is not the
            order's title because this step belongs to the sale being built,
            and the counter underneath says which one. */}
        <ScreenTitle className="font-normal">Nueva venta</ScreenTitle>
        <p className="text-sm text-muted-foreground">1/2 Edita producto</p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* THE PHOTO BLEEDS TO BOTH EDGES, as the frame draws it and as
          `ProductSheet` already does with `p-0`. `AppMain` wraps every screen
          in a `p-4`, so it has to be cancelled with `-mx-4` — the same trick
          `ScreenBackRow` documents, and for the same reason. */}
      <div className="-mx-4 h-[200px] w-[calc(100%+2rem)] bg-muted">
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

      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-normal">{producto.name}</h2>
        <StockBadge quantity={producto.stock} threshold={umbralDeStock} />
        {producto.unit ? (
          <p className="text-xs text-muted-foreground">{producto.unit}</p>
        ) : null}
      </div>

      {/* The frame draws this filled; it is optional in the database, so the
          label is hidden rather than left hanging over nothing. */}
      {producto.description ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">Descripción del producto</p>
          <p className="text-sm leading-relaxed">{producto.description}</p>
        </div>
      ) : null}

      <OrderLineEditForm
        pedidoId={pedido.id}
        // TODAS las líneas con su moneda sellada: `fijarLineaEditada` las
        // necesita para limpiar el abono de un bloque que esta edición deje
        // vacío. Ver el comentario de `alAgregar`.
        lineasDelPedido={todasLasLineas.map((l) => ({
          id: l.id,
          moneda: String(l.currency ?? ""),
        }))}
        lineaId={linea.id}
        productId={producto.id}
        producto={producto.producto}
        cantidad={Number(linea.quantity)}
        moneda={linea.currency as PriceCurrency}
        rates={rates}
        stock={producto.stock}
        monedasDelLibro={monedasDelLibro}
      />
    </div>
  );
}
