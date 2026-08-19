"use client";

import { useState } from "react";
import { Bell, Wallet, ImageUp, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotifications, type NotificationItem } from "@/app/(app)/actions";
import { formatDate } from "@/lib/format";

export function NotificationsButton({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && notifications === null) {
      setLoading(true);
      const data = await getNotifications();
      setNotifications(data);
      setUnreadCount(0);
      setLoading(false);
    }
  }

  return (
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
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Notificaciones</p>
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
                          Cédula: {n.documentId || "—"} · {formatDate(n.occurredAt)}
                        </p>
                      </div>
                    </>
                  ) : n.status === "done" ? (
                    <>
                      <ImageUp className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{n.fileName} procesada</p>
                        <p className="text-xs text-muted-foreground">
                          {n.movementsCount ?? 0} movimientos encontrados · {formatDate(n.occurredAt)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{n.fileName} falló</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {n.errorMessage || "No se pudo procesar"} · {formatDate(n.occurredAt)}
                        </p>
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
  );
}
