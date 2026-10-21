"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { formatCantidad } from "@/lib/products/cantidad";

// LA PÍLDORA «VER CARRITO», del frame `1190:5765`.
//
// Flota sobre la cuadrícula de productos, con el número de artículos dentro, y
// no existe cuando el carrito está vacío.
//
// ===========================================================================
// UNA SOLA PÍLDORA PARA LAS DOS PANTALLAS QUE TIENEN CARRITO
//
// La usa el catálogo del CLIENTE (`/c/<token>`, a través de
// `components/public/cart-pill.tsx`, que es quien sabe de tokens y de rutas) y
// el paso 1 del asistente de venta del TENDERO. Las dos enseñan una
// cuadrícula, las dos acumulan líneas y las dos llevan al mismo sitio: su
// carrito.
//
// Hasta el 2026-10-18 el asistente tenía su propio botón ancho al final de la
// columna, que solo se veía tras recorrer la cuadrícula entera. El dueño pidió
// *«el mismo componente del botón flotante Ver carrito del catálogo,
// exactamente el mismo»*.
//
// ===========================================================================
// POR QUÉ `href` Y `onClick` EN VEZ DE UN SOLO CAMINO
//
// El carrito del cliente es una RUTA (`/c/<token>/carrito`) y el del tendero
// es un PASO en memoria del asistente: navegar allí tiraría el carrito entero.
// Son dos destinos de naturaleza distinta para el mismo gesto, así que la
// píldora acepta los dos y no decide por su cuenta.
//
// Un `Link` cuando hay `href` y no un `button` con `router.push`: Next
// precarga el destino de un enlace visible, y esta píldora siempre lo está.
export function CartPillButton({
  total,
  href,
  onClick,
}: {
  // Cuántos artículos. Con cero no se dibuja nada: un botón que lleva a un
  // carrito vacío es ruido, y encima tapa la última fila de la cuadrícula.
  total: number;
  href?: string;
  onClick?: () => void;
}) {
  if (total <= 0) return null;

  const contenido = (
    <>
      <ShoppingBag className="size-5" aria-hidden="true" />
      Ver carrito
      <span className="flex min-w-6 items-center justify-center rounded-full bg-background/20 px-1.5 text-xs tabular-nums">
        {formatCantidad(total)}
      </span>
    </>
  );

  const clases =
    "pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background shadow-lg transition-transform active:scale-95";

  return (
    // `pb-[max(1rem,env(safe-area-inset-bottom))]` por los iPhone con barra de
    // gestos: sin eso la píldora queda justo debajo de la raya del sistema,
    // donde un toque la abre a medias o no la abre.
    //
    // `z-30` la deja POR DEBAJO de cualquier diálogo (z-50) y de la barra de
    // abajo (z-40). En el asistente esa barra no se dibuja, así que no hay
    // nada con lo que chocar; en el catálogo del cliente tampoco existe.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {href ? (
        <Link href={href} className={clases}>
          {contenido}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={clases}>
          {contenido}
        </button>
      )}
    </div>
  );
}
