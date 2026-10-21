"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Trash2 } from "lucide-react";
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
import { eliminarVenta } from "@/app/(app)/ventas/actions";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";

// EL «⋮» DEL DETALLE DE UNA VENTA. Frame `1487:9876`.
//
// ===========================================================================
// LA CONFIRMACIÓN DICE LO QUE SE LLEVA, CON SUS CIFRAS
//
// Este menú vive en la pantalla de UNA moneda, pero el borrado se lleva la
// VENTA ENTERA — el porqué está en `eliminarVenta`, y se resume en que borrar
// media venta no es representable sin un borrado duro.
//
// Así que la confirmación no puede decir «¿eliminar esta venta?» y ya. Tiene
// que nombrar lo que desaparece: la parte que se está mirando, la de las otras
// monedas si las hay, y sobre todo **los fiados**, que son deuda viva. Un
// tendero que entra a quitar un cobro de 40 dólares y se lleva por delante un
// fiado de 30 euros sin que nadie se lo dijera es el peor resultado posible de
// esta pantalla.
export function VentaAcciones({
  saleId,
  clientId,
  // Lo que desaparece, ya formateado por quien sabe de monedas. Una línea por
  // cosa: «Cobro de contado de $40.00», «Fiado de €30.00».
  loQueSeLleva,
}: {
  saleId: string;
  clientId: string;
  loQueSeLleva: string[];
}) {
  const router = useRouter();
  const guardia = useGuardiaDeCuentaPausada();
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  // HAY FIADO DE POR MEDIO O NO, y la frase cambia. No es cosmético: con un
  // fiado dentro, el borrado mueve el saldo del cliente y lo que se restaura
  // después llega por la notificación del movimiento. Sin fiado no hay
  // movimiento, así que no hay notificación y no hay vuelta atrás desde la
  // app. Las dos cosas hay que decirlas antes, no después.
  const hayFiado = loQueSeLleva.some((l) => l.toLowerCase().startsWith("fiado"));

  async function borrar() {
    if (guardia()) return;
    setBorrando(true);
    const r = await eliminarVenta(saleId);
    setBorrando(false);
    if (!r.ok) {
      if (!avisarCuentaPausada(r.error)) toast.error(r.error);
      return;
    }
    toast.success("Venta eliminada");
    router.replace(`/clients/${clientId}`);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Más opciones">
            <MoreVertical className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmando(true);
            }}
          >
            <Trash2 className="size-4" />
            Eliminar venta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta venta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina la compra entera, no solo lo que estás viendo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* LA LISTA VA FUERA DE `AlertDialogDescription`: ese componente
              monta un `<p>`, y un `<ul>` dentro de un `<p>` es HTML inválido —
              el navegador cierra el párrafo solo y React se queja en
              hidratación. Mismo caso que la casilla de WhatsApp en su diálogo. */}
          <ul className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
            {loQueSeLleva.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                {l}
              </li>
            ))}
          </ul>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {hayFiado
              ? "El saldo de este cliente se recalcula. Podrás restaurarla después desde Notificaciones."
              : "Esta venta no dejó ninguna deuda, así que no genera aviso para restaurarla: una vez eliminada no se puede recuperar desde la app."}
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={borrar} disabled={borrando}>
              {borrando ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
