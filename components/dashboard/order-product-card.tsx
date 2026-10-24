import Image from "next/image";
import Link from "next/link";
import { forwardRef } from "react";
import { ChevronRight, ImageOff, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";

// ONE LINE OF THE ORDER, AS A CARD — frame `1518:10873`, block «Pedido».
//
// ===========================================================================
// IT STOPPED BEING A BUTTON, AND THAT IS THE WHOLE RESTRUCTURE
//
// Until 2026-10-24 the whole row was a single `<button>` that opened the
// product sheet. The frame puts two buttons INSIDE it — «Editar» and
// «Registrar» — and a button cannot contain buttons: the HTML is invalid and
// browsers resolve it by breaking the nesting, which in practice means one of
// the three taps lands somewhere nobody chose.
//
// So the card is a plain container now, and only the top row — photo, name,
// chevron — is the trigger that opens the sheet. The chevron earns its place
// there: it says that THAT row is what opens something, which matters more now
// that there are other things to tap below it.
//
// ───────────────────────────────────────────────────────────────────────
// THE AMOUNT ON THE RIGHT IS THE LINE'S TOTAL, NOT THE UNIT PRICE
//
// The unit price is already on the left, inside «1 × $13,00». Repeating it on
// the right would be the same figure twice with nothing saying they are the
// same; what is missing from that row is what this line COSTS, which is what
// the shopkeeper adds up.
export function OrderProductCard({
  cantidad,
  precioUnitario,
  moneda,
  escalon,
  // THE PRODUCT IS GONE FROM THE CATALOGUE. `catalog_order_items.product_id`
  // is `on delete set null`, so deleting a product leaves its order lines
  // behind with everything the customer saw — name, price, tier — and no
  // product to open.
  productoBorrado,
  // Where «Editar» goes. `null` when there is no product to edit, which is the
  // same condition as `productoBorrado` and is passed apart so this component
  // never builds a route out of an id it was not given.
  hrefEditar,
  // Where «Registrar» goes: step 1/2 of turning THIS line into a sale. Unlike
  // «Editar» it survives a deleted product, because the line keeps everything
  // that gets charged — name, quantity, price — and 1/2 draws its own «this
  // product is gone» state.
  hrefRegistrar,
  rates,
  children,
}: {
  cantidad: number;
  precioUnitario: number;
  moneda: PriceCurrency;
  escalon: PriceTier;
  productoBorrado: boolean;
  hrefEditar: string | null;
  hrefRegistrar: string;
  rates: BolivarRates | null;
  // The sheet's trigger, cloned onto the top row by `SheetTrigger asChild`.
  children: React.ReactNode;
}) {
  const total = Math.round(cantidad * precioUnitario * 100) / 100;
  const enBs =
    rates && moneda !== "VES"
      ? (priceIn("VES", { amount: total, currency: moneda }, rates)?.amount ?? null)
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border p-4">
      {children}

      <div className="flex items-start justify-between gap-2.5 pt-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          {cantidad} × {formatPriceAmount(precioUnitario, moneda)} ·{" "}
          {escalon === "wholesale" ? "al mayor" : "al detal"}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {/* THE FLAG GOES ON THE AMOUNT AND ON THE SIDE OF THE EDGE: this
              column is `items-end`, so it sits to the left of the figure. See
              `DESIGN-SYSTEM.md`, the owner's rule of 2026-10-24. */}
          <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
            <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
            {formatPriceAmount(total, moneda)}
          </span>
          {enBs != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBs(enBs)} hoy
            </span>
          ) : null}
        </span>
      </div>

      {/* THE PRODUCT IS NOT IN THE CATALOGUE ANY MORE — the owner's decision of
          2026-10-24: *«se debe mostrar en el card del producto mensaje de
          error que ya ese producto no existe»*.

          AMBER AND NOT RED, like the card for a client who is not on file: the
          order is fine and the customer did order this. What is missing is on
          the shop's side, and it is older than the order.

          IT SAYS WHAT STILL HOLDS, which is the part that matters: the name
          and the price are the ones the customer saw when they ordered, so the
          line can still be charged. Without that sentence «ya no existe» reads
          as «this line is lost». */}
      {productoBorrado ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <PackageX className="mt-px size-4 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">Este producto ya no está en tu catálogo.</p>
            <p>El nombre y el precio son los que vio el cliente al pedirlo.</p>
          </div>
        </div>
      ) : null}

      {/* HALF AND HALF, from the frame: 145 and 143 of the 304 available.
          `flex-1` on both gives the same split at any width. «Editar» is the
          outlined one and «Registrar» the filled one, in that order, as
          `1544:12040` and `1544:12041` are drawn.

          WITH THE PRODUCT DELETED, ONLY «REGISTRAR» IS LEFT, and it then takes
          the whole row. Editing the catalogue entry of a product that is no
          longer there has nowhere to go; charging the line still does. */}
      <div className="flex gap-4 pt-2">
        {hrefEditar ? (
          <Button variant="outline" size="sm" className="h-10 flex-1" asChild>
            <Link href={hrefEditar}>Editar</Link>
          </Button>
        ) : null}
        <Button size="sm" className="h-10 flex-1" asChild>
          <Link href={hrefRegistrar}>Registrar</Link>
        </Button>
      </div>
    </div>
  );
}

// THE TOP ROW: photo, name, chevron. It is what opens the sheet.
//
// IT FORWARDS THE REF AND SPREADS THE PROPS, and both are mandatory here.
// `SheetTrigger asChild` does not wrap its child: it CLONES it and hangs its
// handlers and its ref on the clone. A component that does not accept them
// renders perfectly and opens nothing — which is exactly what happened the
// first time this row was tried: no console error, no warning, just a button
// that did nothing when tapped.
export const OrderProductRowButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    nombre: string;
    fotoPath: string | null;
  }
>(function OrderProductRowButton({ nombre, fotoPath, ...props }, ref) {
  const fotoUrl = fotoPath ? getPublicProductPhotoUrl(fotoPath) : null;

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className="flex w-full items-center gap-2 text-left"
    >
      {fotoUrl ? (
        <Image
          src={fotoUrl}
          alt=""
          width={80}
          height={80}
          unoptimized
          className="size-10 shrink-0 rounded border object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <ImageOff className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{nombre}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
});
