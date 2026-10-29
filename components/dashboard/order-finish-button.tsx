"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import type { PriceCurrency } from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// «REGISTRAR Y FINALIZAR», ABAJO Y A LO ANCHO — frame `1782:14792`
//
// Decisión del dueño el 2026-10-28: *«este debe aparecer en la parte inferior
// de la pantalla y en el card (…) mantener el botón de "Editar" para editar el
// pedido en esa moneda»*.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ ESTO Y NO EL ROTULO QUE PUSE ANTES
//
// Esa misma mañana cerré el mismo agujero cambiando el rótulo de la tarjeta a
// «Registrar y finalizar» cuando era la última moneda. Funcionaba, y su frame
// es mejor por una razón que no es estética: **ese botón edita UNA moneda, y
// acabar es una acción sobre el PEDIDO**. Dos alcances distintos compartiendo
// un botón es justo lo que hacía que nadie encontrara la salida.
//
// ───────────────────────────────────────────────────────────────────────
// CUÁNDO SE DIBUJA, Y POR QUÉ TAN ESTRECHO
//
// Solo cuando queda UNA moneda viva y YA tiene su monto puesto. Es decir,
// exactamente el estado en el que el dueño se quedó encallado: pone el monto
// de una, quita la otra, y la pantalla se queda sin nada que prometa acabar.
//
// CON DOS O MÁS NO SALE, y no es pereza: con una moneda sin monto no hay nada
// que finalizar, y un botón que dijera «y finalizar» llevaría a un paso que
// pide datos. Prometer el final y entregar un formulario es el tipo de botón
// que enseña a desconfiar de los botones.
//
// ───────────────────────────────────────────────────────────────────────
// NO ESCRIBE LA VENTA: LLEVA AL MISMO SITIO QUE LA TARJETA
//
// Deliberado. Un segundo control que escribiera dinero desde aquí sería un
// SEGUNDO camino hacia la venta, y tendría que repetir el aviso de «mala
// paga», que ya vive en dos sitios. El camino sigue siendo uno; lo que cambia
// es que ahora hay algo en pantalla que dice a dónde lleva.
//
// `StickyActions` Y NO CLASES COPIADAS: es la regla que `CLAUDE.md` recoge
// con sus tres fechas --con el teclado arriba no queda nada pegado abajo-- y
// la segunda vez se rompió precisamente por copiar sus clases a mano.
// ═══════════════════════════════════════════════════════════════════════

export function OrderFinishButton({
  pedidoId,
  /** Las monedas vivas del pedido. Con más de una, esto no se dibuja. */
  monedasVivas,
  href,
}: {
  pedidoId: string;
  monedasVivas: PriceCurrency[];
  /** A dónde lleva: el paso de confirmar de esa única moneda. */
  href: string;
}) {
  const borrador = useBorrador(pedidoId);
  if (monedasVivas.length !== 1) return null;
  if (borrador?.monedas?.[monedasVivas[0]] == null) return null;

  return (
    <StickyActions>
      {/* SIN ICONO, como el frame: el `add_2` de su componente viene con
          `showIcon={false}`. Un «+» delante de «finalizar» diría que agrega
          algo. */}
      <Button className="h-10 w-full" asChild>
        <Link href={href}>Registrar y finalizar</Link>
      </Button>
    </StickyActions>
  );
}
