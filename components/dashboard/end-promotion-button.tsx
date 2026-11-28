"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { endPromotion } from "@/app/(app)/productos/promociones/actions";

// «Terminar ahora» (CT-184, frame 9), behind a confirmation: it cannot be undone, and the
// customer's catalogue goes back to list prices at once. Orders already received keep theirs.
export function EndPromotionButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button type="button" variant="outline" className="h-10 w-full text-destructive md:w-auto" onClick={() => setOpen(true)}>
        Terminar ahora
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Terminar «{name}» ahora?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu catálogo vuelve a sus precios de siempre desde este momento. Los pedidos que ya recibiste guardan su precio. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const r = await endPromotion(id);
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  setOpen(false);
                  toast.success("Promoción terminada.");
                  router.refresh();
                });
              }}
            >
              {pending ? "Terminando…" : "Terminar ahora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
