import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { OrderProductSheet } from "@/components/dashboard/order-product-sheet";
import { createClient } from "@/lib/supabase/server";
import { formatBs } from "@/lib/exchange-rate/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { formatCantidad } from "@/lib/products/cantidad";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  readOrderProducts,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// STEP 1/2 OF REGISTERING ONE LINE OF A CATALOGUE ORDER — frame `1541:11232`
// («Catalog car added», subtitle «1/2 Confirma producto»).
//
// ===========================================================================
// WHERE THIS SCREEN COMES FROM, AND WHY IT IS PER LINE
//
// The order detail draws one card per product with two buttons. «Registrar»
// lands here; the sitemap's own arrow says so, labelled «Selecicona
// "Registrar pedido"», from `1514:9999` to this frame.
//
// It is ONE line at a time, not the whole order: the next step (2/2, frame
// `1564:11028`) asks how that amount is paid — cash or fiado — and that answer
// belongs to a product, not to a basket.
//
// ===========================================================================
// SEALED ON THE LEFT, TODAY'S CATALOGUE ON THE RIGHT
//
// The same split the order's detail already made, the owner's decision of
// 2026-10-17: quantity, unit price and tier are what the customer agreed to
// and never move; description, photo and stock are read to DECIDE whether to
// fulfil it, so a frozen stock from last Tuesday would help nobody.
export default async function ConfirmarProductoPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `.eq("owner_id", user.id)` EXPLICITLY. Both ids arrive from the URL, so
  // this is the rule this project wrote after `getOrCreateShareLink`: RLS is
  // the backstop, not the only line of defence.
  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  // A read that FAILED and an order that is not there both leave this null,
  // and only the second deserves a 404 — the same trap migration 116 sprang
  // on this table in October.
  if (error) console.error("[orders] confirmar producto:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  // THE HARD STOP, AND IT IS THE EXPENSIVE ONE. An order that is already a
  // sale must never walk this flow twice: the second pass would write the
  // charge again and the customer would owe double, with nothing on screen
  // saying so. Migration `157` added these two columns for exactly this.
  //
  // It redirects instead of 404-ing: the order exists, it is simply done, and
  // its own screen is where that is explained. The «registrado + fecha» state
  // the owner asked for on 2026-10-24 is still to be built.
  if (pedido.registered_at != null || pedido.sale_id != null) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  // THE LINE, FILTERED BY ITS ORDER AND NOT BY ITS ID ALONE. Without the
  // `order_id` filter, pasting another order's line id into this URL would
  // register it under this one.
  const { data: itemRow, error: errorItem } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("id", itemId)
    .eq("order_id", pedido.id)
    .maybeSingle();

  if (errorItem) console.error("[orders] confirmar producto item:", errorItem.message);
  if (!itemRow) notFound();
  const linea = itemRow as CatalogOrderItemRow;

  const [productosPorId, rateContext] = await Promise.all([
    readOrderProducts(supabase, user!.id, [linea]),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // A Colombian business has no bolívar rate and converts nothing. See the
  // header of `lib/products/price.ts`.
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  // `null` IS A REAL STATE, not a failure: `catalog_order_items.product_id` is
  // `on delete set null`, so deleting a product leaves the line intact with
  // everything the customer saw. The sealed half still reads; the catalogue
  // half has nothing to show and says so.
  const producto = linea.product_id ? (productosPorId.get(linea.product_id) ?? null) : null;

  const cantidad = Number(linea.quantity);
  const precioUnitario = Number(linea.unit_price);
  // The column is plain `text` in the database; the cast is the one the
  // order's own detail already makes on the same field.
  const moneda = linea.currency as PriceCurrency;
  // «POR PAGAR» IS THE LINE'S TOTAL, NOT THE UNIT PRICE. The quantity is
  // already its own column to the left of it, and the label asks what is owed
  // for this line — the same reading as the card on the order's detail.
  const porPagar = Math.round(cantidad * precioUnitario * 100) / 100;
  const enBs =
    rates && moneda !== "VES"
      ? (priceIn("VES", { amount: porPagar, currency: moneda }, rates)?.amount ?? null)
      : null;

  // THREE STATES AND THE THIRD IS `null` — migration 107's rule, already
  // applied by the public catalogue and the product sheet. `stock_opening` is
  // an OPENING entry, not a live count (see `app/(app)/ventas/actions.ts`),
  // and when nobody ever wrote one, «Disponible: 0» would be a lie: it does
  // not mean there is none, it means nobody counted.
  const stock = producto?.stock_opening == null ? null : Number(producto.stock_opening);
  // NOT ENOUGH IN STOCK. This amber state is NOT in the frame, which draws the
  // chip green and nothing else. It is here because the silent version is the
  // expensive one: confirming a sale of ten units with three in the book is
  // not a cosmetic slip — the customer waits for something that is not there.
  // It is the same chip in another colour, never a new element.
  const faltaStock = stock != null && stock < cantidad;

  const fotoUrl = producto?.photo_path ? getPublicProductPhotoUrl(producto.photo_path) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* `soloEnTelefono={false}`: `app-header.tsx` hides the app bar across
          the whole of `/productos` at EVERY width, so without this the screen
          would have no way out from `sm` up. */}
      <ScreenBackRow
        href={`/productos/ordenes/${pedido.id}`}
        label="Volver al pedido"
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Detalle del pedido</ScreenTitle>
        <p className="text-sm text-muted-foreground">1/2 Confirma producto</p>
        {/* HALF, AND NOT FULL. A bar at 100 % in the middle of a flow says
            «done» and the next screen contradicts it — the owner reported
            exactly that on 2026-10-23 about the payment flow. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* THE SEALED LINE — three columns, exactly as the frame heads them:
          «Producto · Cantidad · Por pagar». */}
      <div className="flex flex-col justify-center rounded-[10px] border p-2.5">
        <div className="flex gap-1.5 text-xs leading-4">
          <p className="w-[124px] shrink-0">Producto</p>
          <p className="min-w-0 flex-1 text-right">Cantidad</p>
          <p className="w-[104px] shrink-0 text-right">Por pagar</p>
        </div>
        <div className="flex justify-center gap-1 pt-2">
          <p className="w-[124px] shrink-0 text-xs leading-4 text-muted-foreground">
            {linea.product_name}
          </p>
          <p className="min-w-0 flex-1 text-right text-xs leading-4 text-muted-foreground tabular-nums">
            {formatCantidad(cantidad)}
          </p>
          <div className="flex w-[104px] shrink-0 flex-col items-end justify-center">
            {/* THE FLAG ON THE SIDE OF THE EDGE: this column is `items-end`,
                so it sits to the right of the figure, as the frame draws it.
                See `DESIGN-SYSTEM.md`, the owner's rule of 2026-10-24. */}
            <span className="flex items-center gap-1 text-sm tabular-nums">
              {formatPriceAmount(porPagar, moneda)}
              <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
            </span>
            {/* «HOY», WHICH THE FRAME DOES NOT WRITE. The owner's decision of
                2026-10-17, on the order's own detail: the amount is sealed and
                its value in bolívares is not, because the rate moves daily.
                Without the word, this figure reads as what was agreed, and the
                shopkeeper charges today's rate for last week's deal. */}
            {enBs != null ? (
              <span className="text-xs leading-4 text-muted-foreground tabular-nums">
                {formatBs(enBs)} hoy
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* AVAILABILITY. Hidden entirely when nobody ever recorded stock — see
          `stock` above for why zero and «unknown» cannot share a chip. */}
      {stock != null ? (
        <span
          className={
            faltaStock
              ? "w-fit rounded-full border border-amber-300 bg-amber-50 px-1.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500"
              : "w-fit rounded-full border border-money-in/30 bg-money-in/10 px-1.5 text-xs text-money-in"
          }
        >
          Disponible: {formatCantidad(stock)}
        </span>
      ) : null}

      {/* THE PRODUCT IS NOT IN THE CATALOGUE ANY MORE. The frame draws no such
          state — it is here because the three blocks below it would otherwise
          be three labels over nothing, with no word saying why.

          AMBER AND NOT RED, and it says what still holds: the line can still
          be charged, because name, quantity and price are the ones the
          customer agreed to. */}
      {producto == null ? (
        <div className="flex flex-col gap-0.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <p className="font-semibold">Este producto ya no está en tu catálogo.</p>
          <p>El nombre y el precio son los que vio el cliente al pedirlo.</p>
        </div>
      ) : null}

      {/* Descripción, Foto y Comentarios del cliente. The frame draws all
          three filled; none of them is mandatory in the database, and a label
          hanging over an empty space reads as a broken screen, so each one is
          hidden when there is nothing to put in it. */}
      {producto?.description ? (
        <div className="flex flex-col justify-center gap-1">
          <p className="text-xs leading-4 text-muted-foreground">Descripción</p>
          <p className="text-sm leading-5">{producto.description}</p>
        </div>
      ) : null}

      {fotoUrl ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Foto</p>
          <Image
            src={fotoUrl}
            alt=""
            width={800}
            height={800}
            unoptimized
            className="h-[137px] w-full rounded-xl border object-cover"
          />
        </div>
      ) : null}

      {linea.comment ? (
        <div className="flex flex-col justify-center gap-1">
          <p className="text-xs leading-4 text-muted-foreground">Comentarios del cliente</p>
          <p className="text-sm leading-5">{linea.comment}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 pb-10 pt-6">
        {/* STEP 2/2 IS NOT BUILT YET. The route is the one the sitemap's arrow
            points at («Selecciona "Continuar"» → frame `1564:11028`, «2/2
            Abono»), so this link is where it will land. */}
        <Button className="h-10 w-full" asChild>
          <Link href={`/productos/ordenes/${pedido.id}/registrar/${linea.id}/abono`}>
            Continuar
          </Link>
        </Button>
        {/* «VER DETALLE DE PRODUCTO» OPENS THE SAME SHEET as the order's
            detail — the sitemap says so: «Al seleccionar producto abre detalle
            en componente sheet», pointing at frame `1519:11100`, which is the
            sheet already built. */}
        <OrderProductSheet
          nombreEnElPedido={linea.product_name}
          cantidad={cantidad}
          precioUnitario={precioUnitario}
          moneda={moneda}
          escalon={linea.tier}
          comentario={linea.comment}
          producto={producto}
          rates={rates}
        >
          <Button variant="outline" className="h-10 w-full">
            Ver detalle de producto
          </Button>
        </OrderProductSheet>
      </div>
    </div>
  );
}
