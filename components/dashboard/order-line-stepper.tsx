"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { aplicarEdicionDeLinea, type LineaDelPedidoParaEditar } from "@/lib/orders/editar-linea";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import { formatCantidad } from "@/lib/products/cantidad";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import type { ProductoPublico } from "@/lib/products/public-pricing";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { quitarLineaDelPedido } from "@/app/(app)/productos/ordenes/actions";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// LA CANTIDAD DE UNA LÍNEA, CON «−» Y «+» — frame `1389:8388`
//
// Encargo del dueño el 2026-10-28: *«al seleccionar "Editar pedido" la edición
// de los productos debería ser con la card del carrito con botones "-" y "+" y
// no el botón "Editar pedido"»*.
//
// Tres cajas de 40×40 con radio 12 y borde, separadas 4, como el frame las
// dibuja: `remove`, la cifra, `add_2`.
//
// ───────────────────────────────────────────────────────────────────────
// LA CIFRA SE PUEDE ESCRIBIR, NO SOLO PULSAR
//
// Es la misma regla que el carrito de la venta ya tiene desde el 2026-10-21,
// y por el mismo motivo: llevar una línea a 100 unidades a toques son noventa
// y nueve. Aquí además importa más -- un pedido llega con la cantidad que el
// cliente pidió, así que corregirla suele ser un salto, no un ajuste.
//
// UN ESTADO DE TEXTO APARTE, y no `String(cantidad)`: mientras se teclea hay
// estados que no son un número --el campo vacío al borrar para reescribir, y
// el «12,» de quien va a poner 12,5, porque esta columna es `numeric(14,3)`
// para quien vende a peso--. Con el valor atado al número, borrar el último
// dígito lo devolvía a 1 y el campo se peleaba con los dedos.
//
// ───────────────────────────────────────────────────────────────────────
// NO SE FRENA EN LO DISPONIBLE, Y ES DELIBERADO
//
// La fila de al lado dice «Disponible: 3» y el pedido puede pedir 10. El «+»
// NO se bloquea ahí, por dos razones:
//
//   1. **El pedido es lo que el cliente pidió.** Frenar la cifra en lo que
//      queda en la estantería cambiaría el pedido por el inventario, y el
//      tendero perdería de vista lo que de verdad le encargaron.
//   2. **Es la decisión que el dueño ya tomó para la venta**, el 2026-10-28:
//      *«Avisa antes de registrar (…) te deja seguir y corregir la cantidad
//      ahí mismo»*. Bloquear aquí sería contestar la misma pregunta de dos
//      formas en dos pantallas del mismo flujo.
//
// El chip «Disponible: N» se queda a la vista justo para esto.
//
// ───────────────────────────────────────────────────────────────────────
// EL MÍNIMO ES 1 Y NO 0
//
// Bajar a cero no es «quitar la línea»: una línea de cero se registraría como
// una venta de nada. Quitar el producto es una acción aparte, y desde el
// 2026-10-28 la hace la PAPELERA que sustituye al «−» en el mínimo.
//
// ESTE COMENTARIO DECÍA OTRA COSA Y ERA FALSO: afirmaba que quitar un
// producto «vive en la hoja de Cambiar». No vivía en ninguna parte -- esa
// hoja cambia la moneda y el escalón, y hasta hoy lo único que se podía
// quitar era una MONEDA entera.
// ═══════════════════════════════════════════════════════════════════════

const MINIMO = 1;
// El mismo techo que la acción de servidor acepta por línea.
const MAXIMO = 1_000_000_000;

export function OrderLineStepper({
  pedidoId,
  lineaId,
  cantidadPedida,
  moneda,
  producto,
  rates,
  lineasDelPedido,
  sePuedeQuitar,
}: {
  pedidoId: string;
  lineaId: string;
  /** Lo que el cliente pidió. Es el valor inicial si nadie lo ha tocado. */
  cantidadPedida: number;
  moneda: PriceCurrency;
  producto: ProductoPublico;
  rates: BolivarRates | null;
  lineasDelPedido: LineaDelPedidoParaEditar[];
  // ── ¿SE PUEDE QUITAR ESTA LINEA? ──────────────────────────────────
  //
  // `false` cuando es la unica viva del pedido: entonces la papelera sale
  // deshabilitada. Un pedido sin nada no se puede registrar y no tiene nada
  // que ensenar -- es la misma razon por la que no se quita la ultima moneda,
  // decidida por el dueno el 2026-10-26.
  //
  // LO DECIDE LA PAGINA porque la pregunta es sobre el PEDIDO entero y esta
  // fila solo conoce la suya. La accion del servidor lo vuelve a comprobar:
  // esto puede ser una pestana vieja.
  sePuedeQuitar: boolean;
}) {
  const router = useRouter();
  const [quitando, startQuitar] = useTransition();
  const borrador = useBorrador(pedidoId);
  const editada = borrador?.editadas?.[lineaId];
  const cantidad = editada?.quantity ?? cantidadPedida;
  // La moneda de la línea también puede estar editada: se respeta, o un
  // cambio de cantidad devolvería la línea a su moneda original sin avisar.
  const monedaViva = (editada?.currency as PriceCurrency | undefined) ?? moneda;

  const [texto, setTexto] = useState(() => formatCantidad(cantidad));
  const [ultima, setUltima] = useState(cantidad);
  // SE RESINCRONIZA AL PINTAR cuando el número cambia por fuera --los botones,
  // o la hoja de «Cambiar»--. Ajustar estado durante el render es el patrón
  // que este repo usa en vez de un efecto, que `eslint` rechaza.
  if (cantidad !== ultima) {
    setUltima(cantidad);
    setTexto(formatCantidad(cantidad));
  }

  function guardar(q: number) {
    const limpia = Math.min(MAXIMO, Math.max(MINIMO, q));
    aplicarEdicionDeLinea({
      pedidoId,
      lineaId,
      quantity: limpia,
      currency: monedaViva,
      producto,
      rates,
      lineasDelPedido,
    });
    // EL SERVIDOR VUELVE A PINTAR. El subtotal y el total de arriba los
    // calcula él, así que sin esto la cantidad cambiaría y el dinero no --
    // dos cifras en la misma tarjeta contándose cosas distintas.
    router.refresh();
  }

  const caja =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm tabular-nums";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* ── EN EL MINIMO, LA PAPELERA ────────────────────────────────
          Encargo del dueno el 2026-10-28: *«cuando el producto es cantidad 1,
          el boton deshabilitado "−" debe ser boton destructive delete igual
          que en el carrito»*.

          ES EL MISMO CODIGO QUE EL CARRITO --`variant` destructive/outline,
          `size-10 rounded-xl`, `Trash2` o `Minus`-- a proposito: lo que pidio
          es que se vean IGUAL, y dos maquetaciones parecidas escritas aparte
          se separan en cuanto alguien retoca una.

          UN «−» DESHABILITADO NO DICE NADA. Era lo que habia: en el minimo el
          boton se apagaba y la unica forma de sacar un producto del pedido
          era quitar su moneda entera -- que con un solo producto en esa
          moneda es lo mismo, y con tres se lleva los otros dos por delante.

          SIN DIALOGO, como el carrito. Y aqui ademas tiene vuelta atras: la
          tarjeta de «Restaurar» aparece debajo. Lo que SI conviene saber es
          que esa tarjeta devuelve TODO lo quitado de esa moneda, no solo esta
          linea. */}
      <Button
        type="button"
        variant={cantidad <= MINIMO ? "destructive" : "outline"}
        size="icon"
        className="size-10 shrink-0 rounded-xl"
        disabled={quitando || (cantidad <= MINIMO && !sePuedeQuitar)}
        aria-label={cantidad <= MINIMO ? "Quitar del pedido" : "Quitar uno"}
        onClick={() => {
          if (cantidad > MINIMO) {
            guardar(cantidad - 1);
            return;
          }
          startQuitar(async () => {
            const r = await quitarLineaDelPedido(pedidoId, lineaId);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {cantidad <= MINIMO ? (
          <Trash2 className="size-4" aria-hidden />
        ) : (
          <Minus className="size-4" aria-hidden />
        )}
      </Button>
      <input
        type="text"
        inputMode="decimal"
        aria-label="Cantidad"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          // LA COMA TAMBIÉN VALE: el teclado de un teléfono en español la
          // ofrece antes que el punto, y «1,5 kilos» es lo que se teclea.
          const n = Number(texto.replace(",", "."));
          if (!Number.isFinite(n) || n < MINIMO) {
            // Lo ilegible vuelve a lo último válido en vez de guardarse: un
            // campo vacío no es «cero unidades», es un campo a medio escribir.
            setTexto(formatCantidad(cantidad));
            return;
          }
          if (n !== cantidad) guardar(n);
          else setTexto(formatCantidad(cantidad));
        }}
        // `text-base` (16px) ES OBLIGATORIO: Safari de iPhone hace zoom al
        // enfocar cualquier campo por debajo de eso y deja la pantalla
        // ampliada. Está en `CLAUDE.md`.
        className={cn(caja, "text-center text-base outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      />
      <button
        type="button"
        aria-label="Agregar uno"
        onClick={() => guardar(cantidad + 1)}
        className={cn(caja, "transition-colors active:bg-accent")}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
