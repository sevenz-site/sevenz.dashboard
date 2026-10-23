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
import { deleteMovement } from "@/app/(app)/dashboard/actions";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

// EL «⋮» DE CADA ABONO, dentro de la ficha de su fiado.
//
// Frame `1489:10209`, nodos `1489:10457` y `1489:10468`.
//
// ===========================================================================
// UNA SOLA OPCIÓN: ELIMINAR. «EDITAR ABONO» SE QUITÓ
//
// Decisión del dueño el 2026-10-23: *«de ser así eliminemos esa opción de
// editar, si el dueño quiere corregir un error debe eliminarlo y agregarlo
// nuevamente»*. El menú lo estrenó él mismo el 2026-10-20 con las DOS
// opciones; esta decisión desplaza aquella, y las dos quedan escritas.
//
// POR QUÉ TENÍA SENTIDO QUITARLA: editar era el único sitio de la app donde
// un movimiento ya guardado cambiaba de importe en su sitio. Todo lo demás se
// corrige borrando y volviendo a registrar, que deja rastro en la papelera y
// un movimiento nuevo con su fecha y su tasa.
//
// LO QUE CUESTA, Y SE DIJO ANTES DE DECIDIR: registrar un abono le manda al
// cliente su recibo por WhatsApp, y la puerta que evita duplicados se cierra
// por el id del abono. Borrar y volver a crear es un abono NUEVO, así que el
// cliente recibe un SEGUNDO recibo y nada le dice que el primero quedó
// anulado. Con «Editar» recibía uno solo. El dueño lo asumió.
//
// Se fue con ella `editarAbonoDirigido`, que no la llamaba nadie más.
//
// ===========================================================================
// ES UN BOTÓN AL LADO DE UN ENLACE, NO DENTRO
//
// La tarjeta entera lleva a la ficha del abono. Meter el «⋮» dentro de ese
// `<a>` sería un `<button>` dentro de un enlace: HTML inválido, y el navegador
// decide por su cuenta qué pasa al tocarlo. Así que la tarjeta pasa a ser un
// contenedor con dos hijos — el enlace, que ocupa todo lo que puede, y este
// botón al final.
export function AbonoAcciones({
  movementId,
  // En la moneda en que se tecleó: bolívares si se escribió así, la del libro
  // si no. Es lo que el diálogo pide, porque es lo que el respaldo guarda.
  montoTecleado,
  monedaTecleada,
  monedaDelLibro,
}: {
  movementId: string;
  montoTecleado: number;
  monedaTecleada: "VES" | PriceCurrency | null;
  monedaDelLibro: PriceCurrency | null;
}) {
  const router = useRouter();
  const guardia = useGuardiaDeCuentaPausada();
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const enBolivares = monedaTecleada === "VES";
  const formatear = (n: number) =>
    enBolivares ? formatBs(n) : formatPriceAmount(n, (monedaDelLibro ?? "COP") as PriceCurrency);

  async function borrar() {
    if (guardia()) return;
    setBorrando(true);
    const r = await deleteMovement(movementId);
    setBorrando(false);
    if (r.error) {
      if (!avisarCuentaPausada(r.error)) toast.error(r.error);
      return;
    }
    toast.success("Abono eliminado");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-2 size-8 shrink-0"
            aria-label="Más opciones de este abono"
          >
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
            Eliminar abono
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este abono?</AlertDialogTitle>
            <AlertDialogDescription>
              La deuda de ese fiado vuelve a subir {formatear(montoTecleado)}. Podrás restaurarlo
              después desde Notificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
