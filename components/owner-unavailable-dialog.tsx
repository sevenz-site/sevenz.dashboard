"use client";

import { MessageCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SUPPORT_WHATSAPP } from "@/lib/config";

const MENSAJE = "Hola, no puedo cargar los datos de mi negocio en Sevenz.";

// Lo que se ve cuando no se pueden leer los datos del negocio, después de que
// readOwnerCountry lo haya intentado dos veces. En la práctica, un corte de red
// que duró más de medio segundo. La ficha del negocio siempre existe: se crea
// en la misma operación que la cuenta de acceso, así que "registro a medias" no
// es un estado posible. Comprobado el 2026-09-11 en dev y en producción: cero
// cuentas sin ficha.
//
// Por qué bloquea la pantalla entera y no solo el botón de registrar: sin país
// no sabemos qué libro lleva este negocio, y los importes de detrás se pintan
// con el formato colombiano. Para un negocio venezolano esas cifras son falsas,
// y enseñar cifras falsas es peor que tapar la pantalla.
//
// Sin "X" ni cancelar, a propósito: detrás no hay nada que hacer. Pero sí una
// segunda salida, y no es un adorno. Con solo "Recargar", un fallo que no se
// arregla solo deja al dueño pulsando el mismo botón una y otra vez, encerrado
// fuera de su propia caja, en las cinco pantallas donde esto puede aparecer.
// El botón de WhatsApp no arregla la causa: convierte "estoy encerrado y no sé
// qué hacer" en "sé a quién escribir", que a las siete de la tarde con clientes
// esperando es toda la diferencia.
export function OwnerUnavailableDialog() {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>No pudimos cargar los datos de tu negocio</AlertDialogTitle>
          <AlertDialogDescription>
            Suele ser un problema pasajero de conexión. Recarga la página para volver a intentarlo.
            Si vuelve a pasar, escríbenos y lo resolvemos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" asChild>
            <a
              href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(MENSAJE)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="size-4" />
              Escríbenos por WhatsApp
            </a>
          </Button>
          <AlertDialogAction onClick={() => window.location.reload()}>Recargar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
