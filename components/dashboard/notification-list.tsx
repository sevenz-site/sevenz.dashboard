"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, ImageUp, CircleX, RotateCcw, Trash2, EyeOff, Package } from "lucide-react";
import { PedidosIcon, VERDE_PEDIDOS } from "@/components/icons/pedidos";
import { restaurarPedido } from "@/app/(app)/productos/ordenes/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MovementDeletionDialog } from "@/components/dashboard/movement-deletion-dialog";
import type { NotificationItem } from "@/app/(app)/actions";
import { restoreClient } from "@/app/(app)/clients/[id]/actions";
import { restoreProduct } from "@/app/(app)/productos/actions";
import Link from "next/link";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
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
                      Cédula: {formatDocumentId(n.documentId, n.documentType)} · {formatDateTime(n.occurredAt)}
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
                    <p className="font-medium">Se eliminó una transacción de {n.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {/* LA MONEDA DEL MOVIMIENTO, no pesos siempre.
                          Encontrado el 2026-10-20 probando el borrado de una
                          venta: un fiado de €30 salía aquí como «$ 30,00».

                          EL DATO YA VIAJABA. `currency` se añadió a esta
                          notificación justo por este fallo --su propio
                          comentario en `app/(app)/actions.ts` lo cuenta-- y se
                          arregló la FICHA que se abre al pulsar «Ver», pero no
                          esta línea, que es la que se lee sin abrir nada. */}
                      {n.type === "charge" ? "Fiado" : "Abono"} ·{" "}
                      {n.currency ? formatDisplayCurrency(n.amount, n.currency) : formatCurrency(n.amount)} ·{" "}
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
              ) : n.kind === "product_hidden" ? (
                <ProductHideRow notification={n} />
              ) : n.kind === "catalog_order" ? (
                <>
                  {/* ── EL MISMO ICONO QUE LA TARJETA «PEDIDOS» DE INICIO ──
                      Encargo del dueño el 2026-10-26: *«las notificaciones
                      relacionadas a pedidos deben tener el mismo ícono de la
                      card "Pedidos" en el home, lo único que cambia es el
                      color según el estado del pedido»*.

                      ERA UN `ShoppingBag` DE LUCIDE, o sea otro dibujo para
                      el mismo hecho. El tendero ve la tarjeta verde en Inicio
                      y el aviso en la campana, y si no son el mismo icono no
                      se leen como lo mismo.

                      VERDE, ROJO Y AZUL, los tres suyos:
                        · recibido    — verde, el de la tarjeta de Inicio
                        · descartado  — rojo, el `--destructive` de la app
                        · restaurado  — azul

                      EL VERDE VA POR SU HEX y no por una clase de Tailwind
                      porque es el color del propio icono, no un token del
                      sistema: está en `VERDE_PEDIDOS`, junto al dibujo, para
                      que la tarjeta y esto no se separen. Los otros dos sí
                      son tokens, porque rojo y azul ya significan algo en
                      esta app. */}
                  <PedidosIcon
                    className={
                      n.estado === "descartado"
                        ? "mt-0.5 size-5 shrink-0 text-destructive"
                        : n.estado === "restaurado"
                          ? "mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400"
                          : "mt-0.5 size-5 shrink-0"
                    }
                    style={
                      n.estado === "recibido" ? { color: VERDE_PEDIDOS } : undefined
                    }
                  />
                  <div className="min-w-0 flex-1">
                    {/* LA FRASE DICE QUIÉN HIZO QUÉ. «Te hizo un pedido» es
                        del cliente; descartar y restaurar son del tendero, y
                        por eso van en segunda persona: es él quien lo hizo y
                        quien puede deshacerlo. */}
                    <p className="font-medium">
                      {n.estado === "descartado"
                        ? `Descartaste el pedido de ${n.customerName}`
                        : n.estado === "restaurado"
                          ? `Restauraste el pedido de ${n.customerName}`
                          : `${n.customerName} te hizo un pedido`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {n.itemCount} {n.itemCount === 1 ? "producto" : "productos"} ·{" "}
                      {formatDateTime(n.occurredAt)}
                    </p>
                    {/* «RESTAURAR» AQUÍ, QUE ES LA OTRA MITAD DEL ENCARGO
                        --*«debe mandar la notificación y ofrecer
                        restaurarlo»*--. El toast que sale al descartar
                        también lo ofrece, pero se va en segundos: este es el
                        del arrepentimiento de mañana. */}
                    {n.estado === "descartado" ? (
                      <OrderRestoreRow orderId={n.orderId} />
                    ) : (
                    <Button asChild type="button" variant="outline" size="sm" className="mt-1.5 h-7">
                      <Link href={`/productos/ordenes/${n.orderId}`}>Ver pedido</Link>
                    </Button>
                    )}
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
    toast.success(`${n.clientName} volvió a tus clientes`);
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

// UN PRODUCTO A LA PAPELERA, Y DE VUELTA.
//
// Decisión del dueño el 2026-10-10. Es el mismo patrón que `ClientHideRow` y
// no una variante: a un dueño, borrar un producto es el mismo gesto que
// borrar un cliente a otra escala, así que se cuenta igual y se deshace igual.
//
// AQUÍ ESTÁ LA ÚNICA VUELTA QUE HOY TIENE UN PRODUCTO BORRADO. La papelera
// todavía no sabe pintar productos — ver CT-44 —, así que si este botón no
// existiera, borrar sería una puerta de un solo sentido. Cuando la papelera
// los pinte, esto seguirá siendo el atajo, no el único camino.
//
// No lleva `onRestored` como la fila de cliente: esa lo necesita para apagar
// el botón de OTRAS filas del mismo cliente en la misma lista. Un producto
// borrado dos veces seguidas es mucho más raro, y `router.refresh()` deja la
// lista correcta de todas formas; añadir el estado compartido sería pagar por
// un caso que no se da.
function ProductHideRow({
  notification: n,
}: {
  notification: Extract<NotificationItem, { kind: "product_hidden" }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const Icon = n.action === "restored" ? RotateCcw : Package;
  const label =
    n.action === "restored"
      ? `Restauraste ${n.productName}`
      : `Eliminaste ${n.productName} de tu catálogo`;

  async function handleRestore() {
    setBusy(true);
    const result = await restoreProduct(n.productId);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${n.productName} volvió a tu catálogo`);
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

// «RESTAURAR» DENTRO DE LA NOTIFICACIÓN DE UN PEDIDO DESCARTADO.
//
// Fila propia y no un `onClick` suelto por lo mismo que `ProductHideRow`, que
// es el precedente exacto de esto: necesita su `useState` de ocupado, y
// meterlo en la lista obligaría a tener uno por cada notificación de la
// pantalla.
function OrderRestoreRow({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="mt-1.5 h-7"
      disabled={ocupado}
      onClick={() => {
        setOcupado(true);
        void restaurarPedido(orderId).then((r) => {
          setOcupado(false);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("El pedido volvió a tu lista");
          router.refresh();
        });
      }}
    >
      {ocupado ? "Restaurando…" : "Restaurar"}
    </Button>
  );
}
