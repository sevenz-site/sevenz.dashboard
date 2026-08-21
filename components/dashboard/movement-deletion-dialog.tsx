"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { restoreMovement } from "@/app/(app)/dashboard/actions";
import type { NotificationItem } from "@/app/(app)/actions";
import { formatCurrency, formatDateTime, formatPlazoDias } from "@/lib/format";

type MovementDeletedNotification = Extract<NotificationItem, { kind: "movement_deleted" }>;

export function MovementDeletionDialog({
  notification,
  open,
  onOpenChange,
  onRestored,
}: {
  notification: MovementDeletedNotification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (id: string) => void;
}) {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);

  if (!notification) return null;

  async function handleRestore() {
    setRestoring(true);
    const result = await restoreMovement(notification!.movementId);
    setRestoring(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Movimiento restaurado");
    onRestored(notification!.id);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Movimiento eliminado</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Cliente</dt>
          <dd>{notification.clientName}</dd>

          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{notification.type === "charge" ? "Fiado (cargo)" : "Abono (pago)"}</dd>

          <dt className="text-muted-foreground">Plazo de pago</dt>
          <dd>{formatPlazoDias(notification.plazoDias)}</dd>

          <dt className="text-muted-foreground">Monto</dt>
          <dd className="tabular-nums">{formatCurrency(notification.amount)}</dd>

          <dt className="text-muted-foreground">Detalle</dt>
          <dd className="truncate">{notification.description || "—"}</dd>

          <dt className="text-muted-foreground">Foto</dt>
          <dd>
            {notification.photoUrl ? (
              <a href={notification.photoUrl} target="_blank" rel="noopener noreferrer">
                <Image
                  src={notification.photoUrl}
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

          <dt className="text-muted-foreground">Fecha del movimiento</dt>
          <dd>{formatDateTime(notification.movementCreatedAt)}</dd>

          <dt className="text-muted-foreground">Por cobrar (en ese momento)</dt>
          <dd className="font-medium tabular-nums">{formatCurrency(notification.runningBalance)}</dd>

          <dt className="text-muted-foreground">Eliminado</dt>
          <dd>{formatDateTime(notification.occurredAt)}</dd>
        </dl>

        <DialogFooter>
          {notification.restored ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Este movimiento ya fue restaurado.
            </p>
          ) : (
            <Button type="button" onClick={handleRestore} disabled={restoring}>
              <Undo2 className="size-4" />
              {restoring ? "Restaurando..." : "Restaurar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
