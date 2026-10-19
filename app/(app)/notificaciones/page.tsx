import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
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
          one: flush to the top, edge to edge. Hidden from sm up, where the real
          header returns.

          SE MUDÓ A `ScreenBackRow` EL 2026-10-18: esta misma fila estaba
          copiada a mano aquí, en Mi negocio, en Subir libreta y en la ficha de
          un pedido, y el flujo de la venta iba a ser la quinta copia. */}
      <ScreenBackRow href="/dashboard" label="Volver a Inicio" />
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
