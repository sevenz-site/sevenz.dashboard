"use client";

import { Loader2 } from "lucide-react";
import { ResumenImportacion } from "@/components/import/resumen-importacion";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { ReviewRow } from "@/lib/reconcile";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// "Confirmar y subir", con su diálogo.
//
// EL NOMBRE, QUE HA CAMBIADO DOS VECES Y POR EL MISMO MOTIVO. Era "Confirmar
// e importar"; pasó a "Guardar todo" el 2026-09-28, cuando la función se
// renombró a "Subir libreta" y el verbo "importar" salió de todo lo que lee el
// dueño. El mapa de pantallas del rediseño seguía diciendo "Confirmar e
// importar" —se dibujó antes de aquel renombrado—, así que se resolvió con la
// mezcla de los dos: "confirmar" del mapa, "subir" del vocabulario de hoy.
// Decidido por el usuario el 2026-09-29.
//
// Vive aparte porque se pinta DOS VECES en la misma pantalla: al final de la
// revisión, donde estaba siempre, y arriba en la cabecera del teléfono, para
// que no haya que bajar veinticinco filas hasta el único botón que guarda.
//
// Dos instancias del mismo componente, no una movida de sitio: cada una monta
// su propio AlertDialog y solo puede haber uno abierto a la vez, porque solo
// se puede pulsar un botón a la vez. Compartir un diálogo entre las dos
// exigiría subir su estado y no compra nada.
//
// LA CONFIRMACIÓN NO SE QUITA por estar ahora más a mano. Esta es la única
// escritura de la app que mete decenas de filas de golpe: lo que se cuela aquí
// no se revisa fila a fila después. Que el botón esté más cerca es justo la
// razón por la que la pregunta se queda.

export function ConfirmarImportacion({
  cuantas,
  filas,
  rateContext,
  deshabilitado,
  guardando,
  onConfirm,
  className,
  size,
}: {
  cuantas: number;
  // Las filas tal cual, no un resumen ya masticado: el resumen se calcula
  // dentro, para que las dos instancias del botón —la del pie y la de la
  // cabecera— no puedan enseñar cuentas distintas.
  filas: ReviewRow[];
  rateContext: MovementRateContext | null;
  deshabilitado: boolean;
  guardando: boolean;
  onConfirm: () => void;
  className?: string;
  // "sm" en la cabecera, donde comparte una barra de 48px con el chevron.
  size?: "sm";
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={deshabilitado} className={className} size={size}>
          {guardando ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Guardando...
            </>
          ) : (
            `Confirmar y subir (${cuantas})`
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Subir {cuantas} {cuantas === 1 ? "movimiento" : "movimientos"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Asegúrate de haber verificado el cliente de cada línea, y sus montos y moneda.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* El resumen va FUERA de AlertDialogDescription: ese componente monta
            un <p>, y estas son tarjetas y una lista. Un <div> dentro de un <p>
            es HTML inválido — el navegador cierra el párrafo por su cuenta y
            React se queja en hidratación. Mismo caso que los tres pasos en la
            hoja de Subir libreta. */}
        <ResumenImportacion rows={filas} rateContext={rateContext} />
        <AlertDialogFooter>
          <AlertDialogCancel>Volver a revisar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Subir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
