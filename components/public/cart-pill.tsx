"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useCarrito } from "@/lib/cart/store";
import { cuantosArticulos } from "@/lib/cart/cart";
import { formatCantidad } from "@/lib/products/cantidad";

// LA PILDORA «VER CARRITO», del frame `1190:5765`.
//
// Flota sobre el catalogo y sobre el detalle, y desaparece cuando el carrito
// esta vacio. Es el unico camino a la pantalla del carrito: el frame no pone
// ningun otro.
//
// VIVE EN EL LAYOUT Y NO EN CADA PAGINA, a proposito. Tiene que salir en la
// lista Y en el detalle, y dos copias de un control acaban divergiendo — la
// del detalle se quedaria sin el contador el dia que alguien lo cambie.
//
// Y SE ESCONDE SOLA EN EL CARRITO. Un boton que lleva a la pantalla en la que
// ya estas es ruido, y encima tapa el de «Completar orden», que es el que
// importa ahi.
export function CartPill({ token }: { token: string }) {
  const { lineas } = useCarrito(token);
  const pathname = usePathname();

  const enElCarrito = pathname === `/c/${token}/carrito`;
  const total = cuantosArticulos(lineas);
  if (total === 0 || enElCarrito) return null;

  return (
    // `pb-[env(safe-area-inset-bottom)]` por los iPhone con barra de gestos:
    // sin eso la pildora queda justo debajo de la raya del sistema, donde un
    // toque la abre a medias o no la abre.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Link
        href={`/c/${token}/carrito`}
        className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background shadow-lg transition-transform active:scale-95"
      >
        <ShoppingBag className="size-5" aria-hidden="true" />
        Ver carrito
        <span className="flex min-w-6 items-center justify-center rounded-full bg-background/20 px-1.5 text-xs tabular-nums">
          {formatCantidad(total)}
        </span>
      </Link>
    </div>
  );
}
