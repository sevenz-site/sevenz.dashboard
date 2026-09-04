"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationList } from "@/components/dashboard/notification-list";
import { getNotifications, getUnreadNotificationCount, type NotificationItem } from "@/app/(app)/actions";

const UNREAD_POLL_MS = 20_000;

// Desktop only — a phone reaches the same notifications through the bottom
// bar and the /notificaciones page instead, where a popover anchored to a
// header button would have nowhere useful to sit.
export function NotificationsButton({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="size-4" />
          Notificaciones
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
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
          <NotificationList notifications={notifications} loading={loading} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
