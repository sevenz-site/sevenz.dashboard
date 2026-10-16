"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: {
  orderId: string;
  atendido: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (atendido) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="size-4" aria-hidden="true" />
        Ya marcaste este pedido como atendido.
      </p>
    );
  }

  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markOrderAttended(orderId);
          // The error goes to the log and the screen does not change: the
          // order is still unattended, which is the truth. An optimistic
          // state here would leave the counter saying one thing and the
          // database another.
          if (r.error) console.error("[orders]", r.error);
          router.refresh();
        })
      }
    >
      {pending ? "Marcando…" : "Marcar como atendido"}
    </Button>
  );
}
