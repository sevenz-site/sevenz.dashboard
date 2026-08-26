"use client";

import { useEffect, useState } from "react";
import { Bell, Wallet, ImageUp, CircleX, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MovementDeletionDialog } from "@/components/dashboard/movement-deletion-dialog";
import { getNotifications, getUnreadNotificationCount, type NotificationItem } from "@/app/(app)/actions";
import { formatCurrency, formatDateTime, formatDocumentId } from "@/lib/format";

const UNREAD_POLL_MS = 20_000;

export function NotificationsButton({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  // This button stays mounted across client-side navigations, so a delete or
  // restore elsewhere on the page (which calls router.refresh()) doesn't
  // reliably re-render this component with a fresh initialUnreadCount on any
  // predictable timing. Rather than depend on that, poll for the true count
  // directly — self-correcting regardless of when/whether the layout re-runs.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const count = await getUnreadNotificationCount();
      if (!cancelled) setUnreadCount(count);
    }
    refresh();
    const interval = setInterval(refresh, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    // Always refetch on open, not just the first time — the list changes as
    // the owner deletes/restores movements or gets new import results while
    // this button stays mounted across client-side navigations.
    if (next) {
      setLoading(true);
      const data = await getNotifications();
      setNotifications(data);
      setUnreadCount(0);
      setLoading(false);
    }
  }

  const viewingNotification =
    (notifications?.find((n): n is Extract<NotificationItem, { kind: "movement_deleted" }> => n.kind === "movement_deleted" && n.id === viewingId) ?? null);

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="size-4" />
            Notificaciones
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium">Notificaciones</p>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cerrar notificaciones"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando...</p>
            ) : !notifications || notifications.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Todavía no tienes notificaciones.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {notifications.map((n) => (
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
                          <p className="font-medium">
                            Se eliminó un movimiento de {n.clientName}
                          </p>
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
          </div>
        </PopoverContent>
      </Popover>

      <MovementDeletionDialog
        notification={viewingNotification}
        open={viewingId !== null}
        onOpenChange={(o) => {
          if (!o) setViewingId(null);
        }}
        onRestored={(id) =>
          setNotifications((prev) => (prev ? prev.map((item) => (item.id === id ? { ...item, restored: true } : item)) : prev))
        }
      />
    </>
  );
}
