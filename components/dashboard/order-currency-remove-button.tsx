"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { quitarMonedaDelPedido } from "@/app/(app)/productos/ordenes/actions";
import { quitarPagoDeMoneda } from "@/lib/orders/borrador-de-registro";
import { currencyName, type PriceCurrency } from "@/lib/products/price";

// «ELIMINAR» UN BLOQUE DE MONEDA — frames `1708:15285` y `1708:15082`.
//
// ═══════════════════════════════════════════════════════════════════════
// QUÉ RESUELVE
//
// Un pedido mixto en el que el tendero solo va a cobrar una de las dos
// monedas. Hasta hoy no había salida: o registraba las dos, o se iba sin
// registrar nada. El dueño lo cerró el 2026-10-26 eligiendo quitar la moneda
// en vez de saltársela: *«ambos pedidos entran juntos en la misma venta»*.
//
// ═══════════════════════════════════════════════════════════════════════
// PREGUNTA ANTES, Y DICE QUÉ SE LLEVA
//
// Petición suya: *«al seleccionar "Eliminar" muestra modal de confirmación»*.
// Y el diálogo nombra la moneda y cuántos productos se van, porque «¿seguro?»
// a secas es una frase que se toca sin leer. Es el mismo criterio que el
// diálogo de «faltan X productos» que tuvo este flujo.
//
// ───────────────────────────────────────────────────────────────────────
// Y TIRA EL ABONO QUE HUBIERA TECLEADO PARA ESA MONEDA
//
// Si el bloque estaba pre-registrado, su monto vive en el borrador del
// navegador. Quitando la moneda y dejando el monto, `registrarTodoElPedido`
// intentaría cobrar una moneda que el pedido ya no tiene --y el servidor la
// rechazaría al final, con todo tecleado--. `quitarPagoDeMoneda` lo limpia en
// el mismo gesto.
//
// EL ORDEN IMPORTA: primero el servidor, después el borrador. Al revés, un
// fallo de red dejaría al tendero sin su monto y con la moneda todavía
// puesta.
export function OrderCurrencyRemoveButton({
  pedidoId,
  moneda,
  cuantosProductos,
  className,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  // Para que el diálogo diga qué se lleva. Opcional: sin él la frase sigue
  // siendo verdad, solo menos concreta.
  cuantosProductos?: number;
  className?: string;
}) {
  const router = useRouter();
  const [preguntando, setPreguntando] = useState(false);
  const [quitando, startTransition] = useTransition();

  const nombre = currencyName(moneda);

  return (
    <>
      {/* ── EN ROJO, LOS DOS, Y ES DECISIÓN DEL DUEÑO ─────────────────
          El 2026-10-26: *«Botón "Eliminar" debe ser destructive tanto en
          modal de la moneda (text destructive) como modal de confirmación
          (filled destructive)»*.

          ESTO DESPLAZA LO QUE AQUÍ DECÍA, y la razón vieja queda escrita
          porque era defendible: el frame `1708:15285` lo pinta sin relleno y
          en el color normal del texto, así que esto nació en `ghost` --«lo
          grave lo dice el diálogo»--. Él lo vio montado y decidió que el
          color lo diga antes.

          LOS DOS NOMBRES SON LOS DEL SISTEMA, no inventados:
          `destructiveText` es rojo sin fondo y `destructive` es rojo con su
          relleno suave. El comentario de `button.tsx` explica por qué existen
          los dos --el de texto pesa menos, para ir al lado de una salida
          segura-- y aquí se usan justo así: plano en la tarjeta, donde
          compite con «Registrar»; relleno en el diálogo, donde es la acción. */}
      <Button
        type="button"
        variant="destructiveText"
        className={className}
        disabled={quitando}
        onClick={() => setPreguntando(true)}
      >
        {quitando ? "Eliminando…" : "Eliminar"}
      </Button>

      <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Quitar lo de {nombre.toLowerCase()} del pedido?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* EL VERBO CONCUERDA CON EL SUJETO, y no es quisquillosería:
                  salía «El producto … no entrarán en la venta», visto en el
                  navegador el 2026-10-26. Una frase mal construida en un
                  diálogo que pregunta antes de destruir algo resta justo lo
                  que ese diálogo necesita, que es que se lea con atención. */}
              {cuantosProductos === 1
                ? `El producto que tu cliente pidió en ${nombre.toLowerCase()} no entrará en la venta. `
                : cuantosProductos != null
                  ? `Los ${cuantosProductos} productos que tu cliente pidió en ${nombre.toLowerCase()} no entrarán en la venta. `
                  : `Lo que tu cliente pidió en ${nombre.toLowerCase()} no entrará en la venta. `}
              Puedes devolverlo mientras no registres el pedido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quitando}>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={quitando}
              onClick={(e) => {
                // `preventDefault` PARA QUE EL DIÁLOGO NO SE CIERRE SOLO:
                // Radix lo cierra al tocar la acción, y entonces el «…» del
                // botón no se vería. Se cierra abajo, cuando hay respuesta.
                e.preventDefault();
                startTransition(async () => {
                  const r = await quitarMonedaDelPedido(pedidoId, moneda);
                  if (!r.ok) {
                    toast.error(r.error);
                    setPreguntando(false);
                    return;
                  }
                  quitarPagoDeMoneda(pedidoId, moneda);
                  setPreguntando(false);
                  router.refresh();
                });
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
