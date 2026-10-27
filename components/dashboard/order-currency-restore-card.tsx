"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restaurarMonedaDelPedido } from "@/app/(app)/productos/ordenes/actions";
import { currencyName, type PriceCurrency } from "@/lib/products/price";

// LO QUE QUEDA EN EL SITIO DE UNA MONEDA QUITADA.
//
// ═══════════════════════════════════════════════════════════════════════
// EL PATRÓN LO ELIGIÓ EL DUEÑO, Y YA EXISTÍA
//
// Sus palabras el 2026-10-26: *«queda pequeña card donde estaba el pedido con
// el botón "Restaurar", mismo patrón que cuando se elimina un registro en la
// verificación de la libreta al importar libreta»*.
//
// Esa tarjeta es la de `components/import/detalle-del-cliente.tsx`, y su
// propio comentario explica por qué funciona: *«la fila quitada se queda a la
// vista, en su sitio… un toast que se va en cinco segundos obliga a
// reaccionar a tiempo; aquí el dueño puede quitar un renglón, seguir
// revisando veinte clientes y recuperarlo al final»*. Aquí pasa igual: puede
// quitar los euros, cobrar los dólares con el cliente delante, y devolverlos
// antes de registrar.
//
// SE QUEDA EN SU SITIO, ENTRE LOS BLOQUES, y no al final de la pantalla. Si
// se fuera abajo, el tendero no vería que falta algo justo donde estaba
// mirando.
//
// ───────────────────────────────────────────────────────────────────────
// Y DESAPARECE SOLA AL REGISTRAR
//
// `registered_at` saca al pedido de este flujo entero, así que esta tarjeta
// solo vive mientras se pueda deshacer. Eso es deliberado: después de la
// venta, «Restaurar» prometería devolver algo a un pedido que ya está
// cerrado.
export function OrderCurrencyRestoreCard({
  pedidoId,
  moneda,
  cuantosProductos,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  cuantosProductos: number;
}) {
  const router = useRouter();
  const [restaurando, startTransition] = useTransition();

  const nombre = currencyName(moneda);

  return (
    // EL BORDE EN ROJO TENUE, como la fila quitada de la libreta: dice que
    // falta algo sin gritarlo. El texto va en el color normal porque lo que
    // está en rojo es el estado, no el dato.
    <div className="flex items-center gap-2 rounded-xl border border-destructive/40 p-4 text-destructive">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium">
          Quitaste lo de {nombre.toLowerCase()}
        </p>
        {/* ── CORTO, Y CON EL VERBO QUE TOCA ───────────────────────
            Decía «1 producto que no entrarán en la venta»: plural sobre un
            sujeto singular, y encima tan largo que se cortaba en el teléfono
            --medido a 375px el 2026-10-26, terminaba en «no entrarán en la
            ve…»--. Una frase truncada en una tarjeta que avisa de algo que
            falta no avisa de nada.

            SIN VERBO, ENTONCES: el rótulo de arriba ya dice lo que pasó
            («Quitaste lo de euros») y esta línea solo cuantifica. */}
        <p className="truncate text-xs opacity-80">
          {cuantosProductos === 1
            ? "1 producto fuera de la venta"
            : `${cuantosProductos} productos fuera de la venta`}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-destructive hover:text-destructive"
        disabled={restaurando}
        onClick={() => {
          startTransition(async () => {
            const r = await restaurarMonedaDelPedido(pedidoId, moneda);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        {restaurando ? "Restaurando…" : "Restaurar"}
      </Button>
    </div>
  );
}
