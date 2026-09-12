"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Lo que se ve cuando no se pudo leer la ficha del negocio — en la práctica,
// un corte de red de unos segundos. La fila siempre existe: el trigger de alta
// la crea en la misma transacción que la cuenta de acceso, así que "registro a
// medias" no es un estado posible. Comprobado el 2026-09-11 en dev y en
// producción: cero cuentas sin ficha.
//
// Por qué bloquea la pantalla entera y no solo el botón de registrar: sin país
// no sabemos qué libro lleva este negocio, y los importes de detrás se pintan
// con el formato colombiano. Para un negocio venezolano esas cifras son falsas,
// y enseñar cifras falsas es peor que tapar la pantalla.
//
// Sin "X" ni cancelar, a propósito. Detrás de este diálogo no hay nada que el
// dueño pueda hacer, así que ofrecerle una salida sería ofrecerle una salida
// falsa: lo único que arregla esto es volver a pedir los datos.
export function OwnerUnavailableDialog() {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>No pudimos cargar los datos de tu negocio</AlertDialogTitle>
          <AlertDialogDescription>
            Es un problema pasajero de conexión. Recarga la página para volver a intentarlo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => window.location.reload()}>Recargar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
