"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, ImageUp, CircleX, RotateCcw, Trash2, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MovementDeletionDialog } from "@/components/dashboard/movement-deletion-dialog";
import type { NotificationItem } from "@/app/(app)/actions";
import { restoreClient } from "@/app/(app)/clients/[id]/actions";
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

  // Restoring from a notification is the undo an owner reaches for ten minutes
  // later, so the row has to stop offering it once it has been taken — every
  // row about the same client, not just the one that was clicked.
  function handleClientRestored(clientId: string) {
    setItems((prev) =>
      prev
        ? prev.map((item) =>
            item.kind === "client_hidden" && item.clientId === clientId
              ? { ...item, canRestore: false }
              : item,
          )
        : prev,
    );
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
              ) : n.kind === "movement_deleted" ? (
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
              ) : (
                <ClientHideRow notification={n} onRestored={handleClientRestored} />
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

// One row for each of the three Papelera transitions. The client is named in
// all three (decision O4): an owner scanning this list needs to know which
// person they hid, and a nameless "ocultaste un cliente" is a record nobody
// can act on.
function ClientHideRow({
  notification: n,
  onRestored,
}: {
  notification: Extract<NotificationItem, { kind: "client_hidden" }>;
  onRestored: (clientId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const Icon = n.action === "restored" ? RotateCcw : n.action === "hidden" ? EyeOff : Trash2;
  const label =
    n.action === "restored"
      ? `Restauraste a ${n.clientName}`
      : n.action === "hidden"
        ? `Ocultaste definitivamente a ${n.clientName}`
        : `Moviste a ${n.clientName} a la papelera`;

  async function handleRestore() {
    setBusy(true);
    const result = await restoreClient(n.clientId);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    onRestored(n.clientId);
    toast.success(`${n.clientName} volvió a tu cartera`);
    router.refresh();
  }

  return (
    <>
      <Icon
        className={
          n.action === "restored"
            ? "mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            : "mt-0.5 size-4 shrink-0 text-muted-foreground"
        }
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(n.occurredAt)}</p>
        {n.canRestore ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1.5 h-7"
            disabled={busy}
            onClick={() => void handleRestore()}
          >
            {busy ? "Restaurando…" : "Restaurar"}
          </Button>
        ) : null}
      </div>
    </>
  );
}
