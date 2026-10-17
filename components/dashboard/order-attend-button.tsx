"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { markOrderAttended } from "@/app/(app)/productos/ordenes/actions";

// THE ONLY BUTTON IN D's READING HALF.
//
// Without it the bell's counter can only go up, and a red number that never
// drops is a number nobody reads -- the owner's decision of 2026-10-16
// (CT-71): the bell counts orders STILL UNATTENDED, not unread notices.
//
// What this button does NOT do, said so it is not mistaken for what is
// missing: it does not correct the customer's details (CT-69) and it does not
// register the order as a fiado or a sale (CT-70). Both have open decisions
// and come after the product selector exists, per the plan of 2026-10-16.
export function OrderAttendButton({
  orderId,
  atendido,
  atendidoEl,
}: {
  orderId: string;
  atendido: boolean;
  // Already formatted, in the business's time zone, by the page that renders
  // this. It is not a `Date` on purpose: formatting it here would use the
  // phone's zone, and the order's own date two lines above is printed in the
  // shop's -- two clocks on one screen.
  atendidoEl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (atendido) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {/* THE DATE IS PART OF THE SENTENCE, at the owner's request on
              2026-10-16. "Ya lo marcaste" answers whether; "el 16 oct. 2026,
              7:35 p. m." answers when, which is the question a shopkeeper
              actually has when a customer rings asking about an order they
              placed days ago.

              Without a date the line also reads the same on the day it
              happened and six months later.

              THE FULL STOP IS ONLY IN THE BRANCH WITHOUT A DATE. The
              formatter ends the time in "p. m." -- a period of its own -- so
              adding another printed "8:42 p. m..", which is what the first
              run of this line looked like on screen. */}
          Ya marcaste este pedido como atendido{atendidoEl ? ` el ${atendidoEl}` : "."}
        </span>
      </p>
    );
  }

  function atender() {
    startTransition(async () => {
      const r = await markOrderAttended(orderId);
      // The error goes to the log and the screen does not change: the
      // order is still unattended, which is the truth. An optimistic
      // state here would leave the counter saying one thing and the
      // database another.
      if (r.error) console.error("[orders]", r.error);
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        // FULL WIDTH ON A PHONE, its own width from `sm`. Owner's request,
        // 2026-10-16. It is the only action on the screen and it sits at the
        // bottom, where the thumb is: a 180px target floating in a 375px row
        // is the hardest shape to hit of the ones available for free.
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        Marcar como atendido
      </Button>

      {/* ===================================================================
          THIS DIALOG IS TEMPORARY, AND IT SAYS SO BECAUSE IT WILL BE EASY TO
          FORGET. Owner's request, 2026-10-16, tracked as `CT-83`.

          WHAT IT IS FOR: "atendido" moves nothing in the ledger. The order
          sits in `catalog_orders` and the money lives in `movements`, and
          nothing joins them yet -- the owner's decision 7 of 2026-10-14 says
          an order does not touch the book. So a shopkeeper who marks three
          orders attended and closes the app has recorded three sales nowhere,
          and would find out at the end of the month.

          WHEN IT GOES: the day this screen can register the order itself as a
          fiado or a cash sale (`CT-70`). From then on the sentence is false
          -- the app WOULD have registered it -- and a warning that lies is
          worse than none, because the next true one gets dismissed as fast.
          =================================================================== */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Marcar este pedido como atendido?</AlertDialogTitle>
            <AlertDialogDescription>
              El movimiento de este pedido tienes que registrarlo a mano, como cualquier otro
              fiado o venta. Estamos trabajando para que el pedido se registre solo desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            {/* `onClick` with `preventDefault` instead of letting the action
                close the dialog on its own: the write has to finish before
                this unmounts, or the refresh lands on a screen that is
                already gone and the button goes back to "sin atender" for a
                frame. */}
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                atender();
              }}
            >
              {pending ? "Marcando…" : "Marcar como atendido"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
