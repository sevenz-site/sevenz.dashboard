"use client";

import { useState } from "react";
import { Wallet, ImageUp, CircleX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MovementDeletionDialog } from "@/components/dashboard/movement-deletion-dialog";
import type { NotificationItem } from "@/app/(app)/actions";
import { formatCurrency, formatDateTime, formatDocumentId } from "@/lib/format";

// The notification rows themselves, shared by the desktop header's popover
// and the phone's own /notificaciones page — the two differ in how they fetch
// (on popover open vs. server-rendered with the page) and in what wraps them,
// not in what a notification looks like.
//
// Owns the "Ver" dialog and a local copy of the list, so restoring a movement
// can mark that row restored in place. The copy re-seeds whenever the caller
// hands down a different array (setState-during-render, the documented way to
// react to a changed prop without an effect).
export function NotificationList({
  notifications,
  loading,
}: {
  notifications: NotificationItem[] | null;
  loading?: boolean;
}) {
  const [items, setItems] = useState(notifications);
  const [lastGiven, setLastGiven] = useState(notifications);
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (notifications !== lastGiven) {
    setLastGiven(notifications);
    setItems(notifications);
  }

  const viewingNotification =
    items?.find(
      (n): n is Extract<NotificationItem, { kind: "movement_deleted" }> =>
        n.kind === "movement_deleted" && n.id === viewingId,
    ) ?? null;

  return (
    <>
      {loading ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando...</p>
      ) : !items || items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Todavía no tienes notificaciones.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5 px-4 py-3 text-sm">
              {n.kind === "link_open" ? (
                <>
                  <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium">{n.clientName} abrió su saldo</p>
                    <p className="text-xs text-muted-foreground">
                      Cédula: {formatDocumentId(n.documentId)} · {formatDateTime(n.occurredAt)}
                    </p>
                  </div>
                </>
              ) : n.kind === "import_result" ? (
                n.status === "done" ? (
                  <>
                    <ImageUp className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{n.fileName} procesada</p>
                      <p className="text-xs text-muted-foreground">
                        {n.movementsCount ?? 0} movimientos encontrados · {formatDateTime(n.occurredAt)}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{n.fileName} falló</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {n.errorMessage || "No se pudo procesar"} · {formatDateTime(n.occurredAt)}
                      </p>
                    </div>
                  </>
                )
              ) : (
                <>
                  <RotateCcw className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Se eliminó un movimiento de {n.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {n.type === "charge" ? "Fiado" : "Abono"} · {formatCurrency(n.amount)} ·{" "}
                      {formatDateTime(n.occurredAt)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1.5 h-7"
                      onClick={() => setViewingId(n.id)}
                    >
                      Ver
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <MovementDeletionDialog
        notification={viewingNotification}
        open={viewingId !== null}
        onOpenChange={(o) => {
          if (!o) setViewingId(null);
        }}
        onRestored={(id) =>
          setItems((prev) => (prev ? prev.map((item) => (item.id === id ? { ...item, restored: true } : item)) : prev))
        }
      />
    </>
  );
}
