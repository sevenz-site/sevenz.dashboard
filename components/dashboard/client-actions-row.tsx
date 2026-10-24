import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// LOS DOS BOTONES DE LA FICHA DEL CLIENTE: «Agregar abono» y «Venta o fiado».
//
// ===========================================================================
// POR QUÉ EXISTE ESTE ARCHIVO
//
// Estos dos botones vivían dentro de `AddMovementDialog`, que los dibujaba
// como su propio disparador. Fueron dejando de abrirlo: «Venta o fiado» pasó
// al asistente el 2026-10-18 y «Agregar abono» a su pantalla 1/3 el
// 2026-10-19, así que para el 2026-10-24 el diálogo solo seguía montado para
// dibujar dos enlaces que no lo abrían.
//
// Ese día el dueño mandó borrar el diálogo viejo —«Agregar transacción»— y lo
// que quedó fue esto: dos enlaces. Sin estado, sin formulario, sin acción de
// servidor. Es un componente de servidor, así que la ficha del cliente deja de
// mandar al navegador el formulario entero para enseñar dos botones.
//
// ===========================================================================
// EL ORDEN ES ABONO A LA IZQUIERDA Y FIADO A LA DERECHA
//
// Es el que los tenderos ya aprendieron en la barra del teléfono que estos
// botones sustituyeron. Escritorio sigue el mismo para que las dos anchuras no
// se contradigan sobre cuál está en cada lado.
export function ClientActionsRow({
  hrefAbono,
  hrefVentaOFiado,
  // SI ESTE CLIENTE DEBE ALGO EN ALGÚN LIBRO. Decide si «Agregar abono» se
  // puede pulsar: sin deuda no hay fiados que listar, así que la pantalla 1/3
  // enseñaría su estado vacío. Apagar el botón se lo ahorra — y el estado
  // vacío sigue cubriendo el caso en que la deuda se salde entre que la página
  // se dibuja y el tendero toca, que es la segunda red.
  puedeAbonar,
  className,
}: {
  hrefAbono: string;
  hrefVentaOFiado: string;
  puedeAbonar: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {/* «AGREGAR ABONO» ABRE SU PROPIA PANTALLA. Decisión del dueño el
          2026-10-19: el abono SIEMPRE se dirige a un fiado concreto, así que
          registrarlo empieza por elegir cuál — pantalla 1/3, `/abonos/nuevo`. */}
      {puedeAbonar ? (
        <Button size="sm" variant="outline" className="flex-1" asChild>
          <Link href={hrefAbono}>
            <Plus className="size-4" />
            Agregar abono
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="flex-1" disabled>
          <Plus className="size-4" />
          Agregar abono
        </Button>
      )}
      {/* «VENTA O FIADO» ABRE EL ASISTENTE. Decisión del dueño el 2026-10-18:
          «renombra el botón de agregar fiado y al seleccionarlo abre el nuevo
          flujo diseñado para agregar venta o fiado».

          El asistente pregunta qué se llevó el cliente antes que cuánto debe, y
          termina pudiendo cobrar parte en el momento. Un fiado sin productos
          sigue siendo posible — es una venta sin pago, y el asistente la hace
          igual. */}
      <Button size="sm" className="flex-1" asChild>
        <Link href={hrefVentaOFiado}>
          <Plus className="size-4" />
          Venta o fiado
        </Link>
      </Button>
    </div>
  );
}
