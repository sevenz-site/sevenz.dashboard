"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { descartarPedido, restaurarPedido } from "@/app/(app)/productos/ordenes/actions";

// EL «⋮» DE LA PANTALLA DE UN PEDIDO, CON «DESCARTAR» DENTRO.
//
// ═══════════════════════════════════════════════════════════════════════
// EL ENCARGO
//
// Del dueño el 2026-10-26: *«en el header, agrega botón "More" con opción
// "Descartar"; al seleccionarla elimina el pedido (debe mandar la
// notificación y ofrecer restaurarlo)»*. El frame de esta pantalla dibuja ese
// «⋮» desde el principio --`topbar` lo trae-- y hasta hoy no hacía nada, así
// que no es un control nuevo: es el que faltaba por llenar.
//
// ═══════════════════════════════════════════════════════════════════════
// PREGUNTA ANTES, AUNQUE SE PUEDA DESHACER
//
// Y no es desconfianza: «Descartar» está a un toque de «Volver» en una barra
// pequeña, y lo que se descarta es el pedido de un cliente que está
// esperando. El diálogo cuesta un toque y dice que tiene vuelta atrás, que es
// la mitad que quita el miedo.
//
// ───────────────────────────────────────────────────────────────────────
// Y OFRECE DEVOLVERLO DOS VECES, A PROPÓSITO
//
// En el toast, ahí mismo, para el arrepentimiento inmediato; y en la campana,
// con su notificación roja, para el de mañana. El toast se va en segundos:
// confiar solo en él es pedirle al tendero que reaccione a tiempo, que es
// justo lo que `detalle-del-cliente.tsx` ya dice de las filas quitadas de la
// libreta.
export function OrderMoreMenu({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  const [preguntando, setPreguntando] = useState(false);
  const [trabajando, startTransition] = useTransition();

  function devolver() {
    startTransition(async () => {
      const r = await restaurarPedido(pedidoId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("El pedido volvió a tu lista");
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Más opciones del pedido"
            disabled={trabajando}
          >
            <MoreVertical className="size-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* `variant="destructive"` del propio menú, que es como ya lo pide
              el «⋮» de la ficha de un cliente. Un rojo escrito a mano aquí
              sería el mismo color por otro camino. */}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setPreguntando(true)}
          >
            Descartar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de tu lista de pedidos y deja de contar como pendiente. Nada
              de lo que pidió tu cliente se borra, y puedes devolverlo desde
              tus notificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando}>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={trabajando}
              onClick={(e) => {
                // El diálogo no se cierra solo: Radix lo cerraría al tocar la
                // acción y el «…» del botón no se vería.
                e.preventDefault();
                startTransition(async () => {
                  const r = await descartarPedido(pedidoId);
                  if (!r.ok) {
                    toast.error(r.error);
                    setPreguntando(false);
                    return;
                  }
                  setPreguntando(false);
                  toast.success("Pedido descartado", {
                    action: { label: "Restaurar", onClick: devolver },
                  });
                  // A LA LISTA, Y NO SE QUEDA AQUÍ. Un pedido descartado ya no
                  // tiene nada que hacer en esta pantalla --su botón de
                  // registrar no aplica-- y dejar al tendero mirándola sería
                  // enseñarle un pedido que acaba de sacar de su lista.
                  router.push("/productos/ordenes");
                  router.refresh();
                });
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
