import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// THE TWO BUTTONS ON A CLIENT'S PAGE: «Agregar abono» and «Venta o fiado».
//
// ===========================================================================
// WHY THIS FILE EXISTS
//
// These two buttons used to live inside `AddMovementDialog`, which drew them
// as its own trigger. They stopped opening it one at a time: «Venta o fiado»
// moved to the sale wizard on 2026-10-18 and «Agregar abono» to its own 1/3
// screen on 2026-10-19, so by 2026-10-24 the dialog was still mounted only to
// draw two links that did not open it.
//
// That day the owner ordered the old «Agregar transacción» dialog deleted, and
// what was left was this: two links. No state, no form, no server action. It
// is a server component, so a client's page stops shipping the whole form to
// the browser in order to show two buttons.
//
// ===========================================================================
// ABONO ON THE LEFT, FIADO ON THE RIGHT
//
// It is the order shopkeepers already learnt from the phone bar these buttons
// replaced. Desktop follows the same one so the two widths do not disagree
// about which side is which.
export function ClientActionsRow({
  hrefAbono,
  hrefVentaOFiado,
  // WHETHER THIS CLIENT OWES ANYTHING IN ANY LEDGER. It decides whether
  // «Agregar abono» can be pressed: with no debt there are no charges to
  // list, so screen 1/3 would show its empty state. Disabling the button
  // saves them that — and the empty state still covers the case where the
  // debt is settled between the page being drawn and the shopkeeper tapping,
  // which is the second net.
  puedeAbonar,
  className,
}: {
  hrefAbono: string;
  hrefVentaOFiado: string;
  puedeAbonar: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {/* «AGREGAR ABONO» OPENS ITS OWN SCREEN. The owner's decision of
          2026-10-19: a payment is ALWAYS aimed at one specific charge, so
          recording it starts by picking which — screen 1/3, `/abonos/nuevo`. */}
      {puedeAbonar ? (
        <Button size="sm" variant="outline" className="flex-1" asChild>
          <Link href={hrefAbono}>
            <Plus className="size-4" />
            Agregar abono
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="flex-1" disabled>
          <Plus className="size-4" />
          Agregar abono
        </Button>
      )}
      {/* «VENTA O FIADO» OPENS THE WIZARD. The owner's decision of 2026-10-18:
          «renombra el botón de agregar fiado y al seleccionarlo abre el nuevo
          flujo diseñado para agregar venta o fiado».

          The wizard asks what the client took before it asks how much they
          owe, and it can end up collecting part of it on the spot. A fiado
          with no products is still possible — it is a sale with no payment,
          and the wizard makes it just the same. */}
      <Button size="sm" className="flex-1" asChild>
        <Link href={hrefVentaOFiado}>
          <Plus className="size-4" />
          Venta o fiado
        </Link>
      </Button>
    </div>
  );
}
