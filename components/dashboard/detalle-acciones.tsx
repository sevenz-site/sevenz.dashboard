"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Percent, Share2, Trash2 } from "lucide-react";
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
import { deleteMovement, getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { mensajeDeSaldo, type DatosParaCompartir } from "@/lib/share-balance";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";

// EL «⋮» DEL DETALLE DE UNA TRANSACCIÓN, en la barra de arriba.
//
// LAS TRES OPCIONES VAN DENTRO DEL MENÚ y no sueltas abajo: decisión del dueño
// el 2026-10-19, preguntada porque el plan de ese mismo día y los frames decían
// cosas distintas —los frames dibujan «Compartir» y «Pagar» como botones al pie
// y el menú aparte— y eligió el menú.
//
// SOLO EN LA PANTALLA DEL DUEÑO. Es su otra decisión, del 2026-10-18: *«Cliente
// no ve ninguna opción ni el botón more»*. La página del cliente sencillamente
// no monta este componente.
export function DetalleAcciones({
  movementId,
  clientId,
  compartir,
  // Lo que ESTE movimiento todavía debe, cuando es un fiado. Decide si el menú
  // ofrece «Pagar»: en un abono no hay nada que abonar, y en un fiado saldado
  // el flujo lo rechazaría con «ese fiado ya está saldado», que es mandar al
  // tendero a un callejón sin salida.
  puedePagar,
}: {
  movementId: string;
  clientId: string;
  compartir: DatosParaCompartir | null;
  puedePagar: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  // Cuenta pausada: borrar un movimiento cambia saldos.
  const guardia = useGuardiaDeCuentaPausada();

  async function handleShare() {
    if (!compartir) return;
    try {
      // El dueño no tiene el enlace a mano y hay que pedirlo. El cliente lo
      // tiene en la barra de direcciones — y además no podría pedirlo, porque
      // crearlo solo responde a un dueño con sesión.
      let url: string;
      if (compartir.enlace.de === "cliente") {
        url = `${window.location.origin}/s/${compartir.enlace.token}`;
      } else {
        const result = await getOrCreateShareLink(compartir.enlace.clientId);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        url = `${window.location.origin}/s/${result.token}`;
      }

      const mensaje = mensajeDeSaldo(compartir.clientName, compartir.balanceText, url);

      // `navigator.share` no existe en el escritorio de casi nadie.
      // Portapapeles como respaldo, con el mensaje entero y no solo el enlace:
      // lo que se pega tiene que ser lo mismo que habría mandado el menú.
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: mensaje });
        return;
      }
      await navigator.clipboard.writeText(mensaje);
      toast.success("Mensaje copiado", { description: mensaje });
    } catch (error) {
      // Cerrar el menú de compartir cuenta como un error para el navegador, y
      // no lo es: el dueño cambió de idea.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("No pudimos compartir el enlace. Inténtalo de nuevo.");
    }
  }

  async function handleDelete() {
    if (guardia()) return;
    setBorrando(true);
    const result = await deleteMovement(movementId);
    setBorrando(false);
    if (result.error) {
      if (!avisarCuentaPausada(result.error)) toast.error(result.error);
      return;
    }
    toast.success("Transacción eliminada");
    // LA FICHA QUE SE ESTABA MIRANDO YA NO EXISTE, así que no se puede quedar
    // en ella. Vuelve a la cuenta del cliente, que es de donde se vino y donde
    // se ve el saldo recalculado. Era un diálogo hasta el 2026-10-19 y ahí
    // bastaba con cerrarlo.
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
          {compartir ? (
            <DropdownMenuItem onSelect={() => void handleShare()}>
              <Share2 className="size-4" />
              Compartir
            </DropdownMenuItem>
          ) : null}
          {puedePagar ? (
            <DropdownMenuItem asChild>
              {/* AL PASO 3/3 DE ESE FIADO, no al 1/3: el fiado ya está elegido
                  y volver a pedir cuál sería preguntar algo ya contestado. */}
              <Link href={`/abonos/nuevo/${movementId}/monto`}>
                <Percent className="size-4" />
                Pagar
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              // Sin esto el menú se cierra ANTES de que el estado cambie y la
              // confirmación se abre sobre algo que se está desmontando.
              e.preventDefault();
              setConfirmando(true);
            }}
          >
            <Trash2 className="size-4" />
            Eliminar transacción
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* CONTROLADA Y FUERA DEL MENÚ, por lo mismo: dentro, su disparador se
          desmonta en el gesto que debería abrirla. */}
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta transacción?</AlertDialogTitle>
            <AlertDialogDescription>
              Se recalculará el saldo de este cliente y el capital por cobrar. Podrás restaurarlo
              después desde Notificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={borrando}>
              {borrando ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
