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
  bloqueVivo = false,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  cuantosProductos: number;
  // ¿La moneda sigue teniendo lineas vivas? `true` cuando se quito solo
  // parte de ella. Lo decide la PAGINA, que es la que conoce los bloques.
  bloqueVivo?: boolean;
}) {
  const router = useRouter();
  const [restaurando, startTransition] = useTransition();

  // CON MAYUSCULA INICIAL, como el frame `1782:14737` lo escribe: «Eliminaste
  // el pedido en Euros». `currencyName` devuelve la palabra en minuscula
  // porque sus otros usos la meten dentro de una frase; aqui nombra un LIBRO,
  // no una cantidad.
  const bruto = currencyName(moneda);
  const nombre = bruto.charAt(0).toUpperCase() + bruto.slice(1);

  return (
    // EL BORDE EN ROJO TENUE, como la fila quitada de la libreta: dice que
    // falta algo sin gritarlo. El texto va en el color normal porque lo que
    // está en rojo es el estado, no el dato.
    // EL FRAME LE DA FONDO, no solo borde: `#ffebeb` con el borde en
    // `--destructive` entero. `bg-destructive/5` es ese mismo rojo al 5%,
    // que es el que esta app ya usa para las superficies de aviso -- un
    // literal aqui seria el mismo color por otro camino, y no giraria con el
    // tema oscuro.
    <div className="flex items-center gap-2 rounded-[10px] border border-destructive bg-destructive/5 p-4 text-destructive">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* EL TEXTO DEL FRAME `1782:14737`, pedido por el dueno el
            2026-10-28: «Eliminaste el pedido en Euros».

            LA MONEDA VA CON MAYUSCULA porque el frame la escribe asi y
            porque aqui nombra un libro --«el pedido en Euros»-- no una
            cantidad de dinero. Antes iba en minuscula dentro de «lo de
            euros», que era otra frase. */}
        {/* ── DOS FRASES, PORQUE SON DOS COSAS ─────────────────────
            «Eliminaste el pedido en Euros» es el texto del frame
            `1782:14737` y es verdad cuando se quito la moneda ENTERA.

            DESDE QUE SE PUEDE QUITAR UNA SOLA LINEA --2026-10-28, por la
            papelera del «−»-- hay otro caso: quitar un producto de un bloque
            de tres deja el bloque VIVO, ahi mismo, con sus otros dos. Decir
            «eliminaste el pedido en Euros» con el pedido en euros dibujado
            dos dedos mas arriba no es un matiz: es la tarjeta
            contradiciendo a la pantalla. */}
        <p className="truncate text-xs font-semibold">
          {bloqueVivo
            ? `Quitaste ${cuantosProductos === 1 ? "un producto" : "productos"} de ${nombre}`
            : `Eliminaste el pedido en ${nombre}`}
        </p>
        {/* ── LA SEGUNDA LINEA, TAMBIEN DEL FRAME ──────────────────
            «<00> productos eliminados del pedido».

            SIGUE SIENDO CORTA A PROPOSITO, que es lo que costo el 2026-10-26:
            decia «1 producto que no entraran en la venta» --plural sobre un
            sujeto singular, y tan largo que a 375px terminaba en «no entraran
            en la ve…»--. Una frase truncada en una tarjeta que avisa de algo
            que falta no avisa de nada. La del frame cabe. */}
        <p className="truncate text-xs">
          {cuantosProductos === 1
            ? "1 producto eliminado del pedido"
            : `${cuantosProductos} productos eliminados del pedido`}
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
