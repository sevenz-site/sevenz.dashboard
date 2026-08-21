"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteMovement } from "@/app/(app)/dashboard/actions";
import { formatCurrency, formatDate, formatPlazoDias } from "@/lib/format";
import type { MovementType } from "@/lib/types";

export function MovementDetailPopover({
  movementId,
  type,
  amount,
  description,
  plazoDias,
  createdAt,
  runningBalance,
  balanceLabel = "Por cobrar",
  photoUrl,
  children,
}: {
  // Only the owner's dashboard passes this — it's what shows the "Eliminar
  // movimiento" action. The public client page omits it entirely.
  movementId?: string;
  type: MovementType;
  amount: number;
  description: string | null;
  plazoDias: number | null;
  createdAt: string;
  runningBalance: number;
  // Label for the running-balance row — the owner's dashboard says "Por
  // cobrar"; the public client page says "Debe"/"A favor"/"Sin deuda".
  balanceLabel?: string;
  // undefined omits the "Foto" row entirely (e.g. the public share page,
  // which never exposes attachment photos). null means "no photo attached".
  photoUrl?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!movementId) return;
    setDeleting(true);
    const result = await deleteMovement(movementId);
    setDeleting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Movimiento eliminado");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detalle del movimiento</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{type === "charge" ? "Fiado (cargo)" : "Abono (pago)"}</dd>

          <dt className="text-muted-foreground">Plazo de pago</dt>
          <dd>{formatPlazoDias(plazoDias)}</dd>

          <dt className="text-muted-foreground">Monto</dt>
          <dd className="tabular-nums">{formatCurrency(amount)}</dd>

          <dt className="text-muted-foreground">Detalle</dt>
          <dd className="truncate">{description || "—"}</dd>

          {photoUrl !== undefined ? (
            <>
              <dt className="text-muted-foreground">Foto</dt>
              <dd>
                {photoUrl ? (
                  <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                    <Image
                      src={photoUrl}
                      alt="Foto del movimiento"
                      width={64}
                      height={64}
                      unoptimized
                      className="size-16 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </>
          ) : null}

          <dt className="text-muted-foreground">Fecha</dt>
          <dd>{formatDate(createdAt)}</dd>

          <dt className="text-muted-foreground">{balanceLabel}</dt>
          <dd className="font-medium tabular-nums">{formatCurrency(runningBalance)}</dd>
        </dl>

        {movementId ? (
          <AlertDialog>
            <div className="-mt-1 flex border-t pt-2.5">
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="icon">
                  <Trash2 className="size-4" />
                  <span className="sr-only">Eliminar movimiento</span>
                </Button>
              </AlertDialogTrigger>
            </div>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se recalculará el saldo de este cliente y el capital por cobrar. Podrás
                  restaurarlo después desde Notificaciones.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
