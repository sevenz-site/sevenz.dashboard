import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationList } from "@/components/dashboard/notification-list";
import { MarkNotificationsSeen } from "@/components/dashboard/mark-notifications-seen";
import { getNotifications } from "@/app/(app)/actions";

// The phone's own notifications screen, reached from the bottom bar — the
// desktop header's popover has nowhere sensible to anchor on a 375px screen.
// Server-rendered rather than fetched on mount: there's nothing to open
// first, so the list is just part of the page.
export default async function NotificacionesPage() {
  const notifications = await getNotifications();

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Replaces the app header on a phone (see AppHeader), so it behaves like
          one: flush to the top, edge to edge. The negative margins cancel main's
          p-4 and px-4 restores the inset for the content itself. Hidden from sm
          up, where the real header returns. */}
      <div className="-mx-4 -mt-4 flex items-center border-b px-4 py-3 sm:hidden">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/dashboard" aria-label="Volver a Cartera">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notificaciones</h1>
        <p className="text-sm text-muted-foreground">
          Lo que pasó en tu cartera mientras no estabas.
        </p>
      </div>
      {/* -mx-4 so each row's own px-4 lines up with the page's inset instead
          of doubling it — the list is written for a popover's edge-to-edge
          rows, and reusing it means reusing that padding. */}
      <div className="-mx-4 border-y">
        <NotificationList notifications={notifications} />
      </div>
      <MarkNotificationsSeen />
    </div>
  );
}
