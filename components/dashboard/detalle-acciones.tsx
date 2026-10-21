"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, MoreVertical, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StickyActions } from "@/components/dashboard/sticky-actions";
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
// COMPARTIR, FUERA DE LOS DOS COMPONENTES QUE LO USAN.
//
// Desde el 2026-10-20 hay dos disparadores para la misma acción: la opción del
// menú «⋮» y el botón «Compartir» de abajo, que el dueño pidió que se
// repitieran. Dos copias de esta función es exactamente como acaban mandando
// mensajes distintos.
async function compartirSaldo(compartir: DatosParaCompartir | null) {
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

    // `navigator.share` no existe en el escritorio de casi nadie. Portapapeles
    // como respaldo, con el mensaje entero y no solo el enlace: lo que se pega
    // tiene que ser lo mismo que habría mandado el menú.
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ text: mensaje });
      return;
    }
    await navigator.clipboard.writeText(mensaje);
    toast.success("Mensaje copiado", { description: mensaje });
  } catch (error) {
    // Cerrar el menú de compartir cuenta como un error para el navegador, y no
    // lo es: el dueño cambió de idea.
    if (error instanceof DOMException && error.name === "AbortError") return;
    toast.error("No pudimos compartir el enlace. Inténtalo de nuevo.");
  }
}

// ===========================================================================
// «PAGAR» LLEVA UN `?desde=detalle`, Y NO ES COSMÉTICO
//
// La pantalla del monto es el paso 3/3 de un flujo de tres, y desde aquí se
// entra directamente a ella. Sin ese marcador se presentaba como «3/3» y su
// flecha de volver apuntaba al paso 2/3 — así que el tendero que llegó de la
// ficha y se arrepentía salía caminando hacia atrás por dos pantallas que
// nunca vio, en vez de volver a donde estaba.
//
// Lo reportó el dueño el 2026-10-20. Con el marcador, esa pantalla se enseña
// como «1/1» y su flecha vuelve al detalle.
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

  const handleShare = () => compartirSaldo(compartir);

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
              <Link href={`/abonos/nuevo/${movementId}/monto?desde=detalle`}>
                {/* EL BILLETE, no el porcentaje. Pedido por el dueño el
                    2026-10-20: es el mismo icono que «Ir a pago» en el paso
                    2/4 de una venta nueva, y los dos llevan al mismo sitio.
                    El `%` venía de que un abono es parte de una deuda, que es
                    una idea de contabilidad; un billete es lo que el tendero
                    tiene en la mano cuando pulsa esto. */}
                <Banknote className="size-4" />
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

// LOS DOS BOTONES DE ABAJO — frames `1463:18100` (fiado) y `1465:18349`
// (abono).
//
// SON LOS MISMOS QUE EL MENÚ «⋮», Y ESO ES LO PEDIDO. El 2026-10-19 las tres
// acciones se metieron dentro del menú; el 2026-10-20, viendo los frames, el
// dueño aclaró que se repiten: *«te dije que se redundaban, en el caso del
// fiado se ven los botones "Compartir" y "Pagar" también fuera del botón more
// y en el caso de abono solo se ve el botón "Compartir"»*. Las dos decisiones
// quedan escritas; esta desplaza a la otra en lo de «solo en el menú».
//
// «Eliminar transacción» NO baja: no está en ningún frame, y es la única de
// las tres que no se puede deshacer de un toque. Un botón destructivo a ancho
// completo al final de una pantalla que se recorre con el pulgar es justo
// donde no debe estar.
export function DetalleBotones({
  movementId,
  compartir,
  puedePagar,
}: {
  movementId: string;
  compartir: DatosParaCompartir | null;
  puedePagar: boolean;
}) {
  return (
    // ── PEGADOS AL BORDE DE ABAJO, SIEMPRE A LA VISTA ──────────────────
    //
    // Instrucción del dueño el 2026-10-21: *«botón "Compartir" y "Pagar"
    // siempre visibles en la parte inferior de la pantalla, actualmente se
    // ocultan al abrir el detalle»*.
    //
    // Estaban al FINAL del contenido, así que en un fiado con tres abonos, su
    // tabla de cuotas y su foto había que recorrer la pantalla entera para
    // cobrar. Es el mismo arreglo que el flujo de registrar recibió el
    // 2026-10-18 y por la misma razón: la acción que cierra la gestión no se
    // busca, se tiene.
    //
    // `StickyActions` Y NO UN `sticky` ESCRITO AQUÍ. Es la regla que acaba de
    // costar tres reportes: una copia de sus clases no hereda lo único que
    // añade sobre un `sticky`, que es esconderse con el teclado. Esta pantalla
    // no tiene campos hoy y da igual — el día que los tenga, ya está resuelto.
    //
    // Y LA RUTA ENTRA EN `conBarraDeBotones` de `app-main.tsx` en el mismo
    // cambio: esa barra trae su propio aire de 40px, y sin la ruta en esa
    // lista `main` le suma otros 16 y la deja flotando al final del scroll.
    <StickyActions>
      {compartir ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={() => void compartirSaldo(compartir)}
        >
          <Share2 className="size-5" aria-hidden />
          Compartir
        </Button>
      ) : null}
      {puedePagar ? (
        <Button asChild className="h-10 w-full">
          <Link href={`/abonos/nuevo/${movementId}/monto?desde=detalle`}>Pagar</Link>
        </Button>
      ) : null}
    </StickyActions>
  );
}
