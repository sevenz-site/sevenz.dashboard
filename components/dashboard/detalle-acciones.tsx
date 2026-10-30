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
import { Checkbox } from "@/components/ui/checkbox";
import { deleteMovement, getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { mensajeDeTransaccion, type DatosParaCompartir } from "@/lib/share-balance";
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
async function compartirTransaccion(compartir: DatosParaCompartir | null, movementId: string) {
  if (!compartir) return;
  try {
    // El dueño no tiene el enlace a mano y hay que pedirlo. El cliente lo
    // tiene en la barra de direcciones — y además no podría pedirlo, porque
    // crearlo solo responde a un dueño con sesión.
    //
    // EL ENLACE LLEVA A ESTA TRANSACCIÓN y no al perfil del cliente —encargo
    // del dueño el 2026-10-30—. Antes terminaba en `/s/<token>` y quien lo
    // abría tenía que encontrar él la transacción de la que se hablaba.
    let token: string;
    if (compartir.enlace.de === "cliente") {
      token = compartir.enlace.token;
    } else {
      const result = await getOrCreateShareLink(compartir.enlace.clientId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      token = result.token;
    }
    const url = `${window.location.origin}/s/${token}/t/${movementId}`;

    const mensaje = mensajeDeTransaccion(compartir.clientName, compartir.transactionCode, url);

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
  abonosDirigidos = 0,
  lineasDelReparto = 1,
}: {
  movementId: string;
  clientId: string;
  compartir: DatosParaCompartir | null;
  puedePagar: boolean;
  // CUÁNTOS ABONOS APUNTAN A ESTE FIADO. Cero en un abono y en un fiado al que
  // nadie ha pagado nada, y entonces el diálogo no pregunta nada: una casilla
  // sobre «sus abonos» cuando no hay ninguno es una pregunta sin respuesta.
  abonosDirigidos?: number;
  // CUÁNTAS LÍNEAS TIENE ESTE ABONO, si es un reparto. Más de una cambia lo que
  // el diálogo promete: se borra el abono entero (decisión del dueño el
  // 2026-10-30) y vuelve con un solo aviso en Notificaciones.
  lineasDelReparto?: number;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  // ── ¿SE VAN TAMBIÉN SUS ABONOS? ────────────────────────────────────
  //
  // APAGADA POR DEFECTO, y es la decisión que importa de esta casilla. Lo que
  // el cliente entregó pasó de verdad; lo que puede estar mal anotado es el
  // fiado. Marcada por defecto, un toque de más le borraría al cliente un pago
  // que sí hizo — y eso no se ve hasta que alguien discute el saldo.
  //
  // SE REARMA EN LOS DOS SITIOS —al cerrar el diálogo y al abrirlo desde el
  // menú— porque uno solo no basta. El porqué, y lo que se midió, está en el
  // `onOpenChange` del diálogo.
  const [tambienAbonos, setTambienAbonos] = useState(false);
  // Cuenta pausada: borrar un movimiento cambia saldos.
  const guardia = useGuardiaDeCuentaPausada();

  const handleShare = () => compartirTransaccion(compartir, movementId);

  async function handleDelete() {
    if (guardia()) return;
    setBorrando(true);
    const result = await deleteMovement(movementId, {
      conAbonos: abonosDirigidos > 0 && tambienAbonos,
    });
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
              // LA CASILLA SE REARMA AQUÍ, que es donde de verdad se abre.
              // Ver el porqué en el `onOpenChange` del diálogo.
              setTambienAbonos(false);
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
      <AlertDialog
        open={confirmando}
        onOpenChange={(abierto) => {
          // SE REARMA AL CERRAR, Y TAMBIÉN AL ABRIR DESDE EL MENÚ.
          //
          // HACEN FALTA LAS DOS, y esto estuvo mal escrito hasta que se probó.
          // `onOpenChange` es de Radix y solo se dispara cuando el DIÁLOGO
          // pide el cambio —Cancelar, Escape, tocar fuera—, no cuando el menú
          // pone `setConfirmando(true)` a mano. Con el rearme solo aquí y solo
          // «al abrir», marcar la casilla, cancelar y volver a entrar la
          // encontraba MARCADA: medido en dev el 2026-10-23, con el comentario
          // de al lado afirmando lo contrario.
          //
          // POR QUÉ IMPORTA: la segunda vez el tendero cree que borra el fiado
          // y borra también el pago que su cliente sí hizo. No falla nada y no
          // se ve hasta que alguien discute el saldo.
          setTambienAbonos(false);
          setConfirmando(abierto);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta transacción?</AlertDialogTitle>
            <AlertDialogDescription>
              {lineasDelReparto > 1
                ? `Se eliminará el abono completo, con su reparto en ${lineasDelReparto} fiados. Se recalculará el saldo de este cliente y podrás restaurarlo después desde Notificaciones.`
                : "Se recalculará el saldo de este cliente y el capital por cobrar. Podrás restaurarlo después desde Notificaciones."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* QUÉ PASA CON LO QUE YA LE ABONARON — encargo del dueño el
              2026-10-23. El porqué de preguntarlo en vez de decidirlo está en
              `deleteMovement`.

              EL AVISO DICE LO QUE PASA SI NO SE MARCA, no lo que pasa si se
              marca: lo segundo es obvio —se borra— y lo primero es justo lo
              que sorprende, porque un abono sin su fiado sigue descontando del
              saldo y no se ve en ninguna parte hasta que alguien suma. */}
          {abonosDirigidos > 0 ? (
            <div className="flex flex-col gap-2 rounded-[10px] border p-3">
              <label className="flex items-start gap-2.5 text-sm leading-5">
                <Checkbox
                  checked={tambienAbonos}
                  onCheckedChange={(v) => setTambienAbonos(v === true)}
                  disabled={borrando}
                  className="mt-0.5"
                />
                <span>
                  Eliminar también {abonosDirigidos === 1 ? "su abono" : `sus ${abonosDirigidos} abonos`}
                </span>
              </label>
              <p className="text-xs leading-4 text-muted-foreground">
                {tambienAbonos
                  ? "Se eliminarán con el fiado. Podrás restaurar cada uno por separado desde Notificaciones."
                  : abonosDirigidos === 1
                    ? "Si no lo eliminas, ese abono se queda y se seguirá descontando del saldo del cliente."
                    : "Si no los eliminas, esos abonos se quedan y se seguirán descontando del saldo del cliente."}
              </p>
            </div>
          ) : null}

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
          onClick={() => void compartirTransaccion(compartir, movementId)}
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
