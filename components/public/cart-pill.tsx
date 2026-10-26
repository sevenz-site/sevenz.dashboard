"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { CartPillButton } from "@/components/cart-pill-button";
import { useCarrito } from "@/lib/cart/store";
import { cuantosArticulos } from "@/lib/cart/cart";

// CUÁNDO SALE LA PÍLDORA EN EL CATÁLOGO DEL CLIENTE.
//
// El dibujo vive en `CartPillButton`, compartido con el asistente de venta del
// tendero desde el 2026-10-18. Aquí queda lo que es SOLO de esta pantalla: de
// qué carrito se lee el total y en qué rutas no debe aparecer.
//
// Flota sobre el CATÁLOGO y desaparece cuando el carrito está vacío. Es el
// único camino a la pantalla del carrito: el frame no pone ningún otro.
//
// YA NO SALE EN EL DETALLE DE UN PRODUCTO, y esto deshace lo que este mismo
// comentario decía hasta el 2026-10-26 --*«Flota sobre el catalogo y sobre el
// detalle»*, *«Tiene que salir en la lista Y en el detalle»*--. Lo cambió el
// dueño ese día, con la captura: *«el botón "Ver carrito" se muestra en el
// detalle de un producto y solapa el botón "Agregar", está mal, en esa
// pantalla oculta el botón "Ver carrito"»*.
//
// Y NO ES UN DETALLE ESTÉTICO. `CLAUDE.md` tiene una sección entera sobre
// esto --«El botón flotante no puede pisar las acciones de una pantalla»--
// por el fallo exacto que se ve en su captura: el cliente le da a «Agregar» y
// lo que se abre es otra cosa. El síntoma --«le di y se abrió otra cosa»-- no
// se parece en nada a la causa.
//
// LO QUE SE PIERDE: desde el detalle ya no hay atajo al carrito. Se vuelve
// con la flecha de arriba al catálogo, donde la píldora sigue estando.
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
  const searchParams = useSearchParams();

  const enElCarrito = pathname === `/c/${token}/carrito`;
  // EL DETALLE DE UN PRODUCTO: `/c/<token>/<productId>`, o sea cuatro
  // segmentos. Se cuentan los segmentos en vez de mirar un prefijo porque
  // `startsWith` también casaría con el carrito y con cualquier pantalla que
  // cuelgue de aquí mañana.
  const segmentos = pathname.split("/").filter(Boolean);
  const enElDetalle = segmentos.length === 3 && segmentos[0] === "c" && !enElCarrito;
  // Y TAMPOCO EN LA VISTA PREVIA DEL TENDERO, desde el 2026-10-17: ahí la
  // pantalla es solo para mirar, y esta píldora es el ÚNICO camino al
  // carrito —lo dice el comentario de arriba—, así que quitarla cierra el
  // resto del flujo sin tocar nada más.
  //
  // Se lee del cliente y no del servidor porque un layout de Next no recibe
  // `searchParams`. No hay parpadeo posible: la píldora solo existe con el
  // carrito lleno, y el tendero que acaba de abrir su previa lo tiene vacío.
  const enLaVistaPrevia = searchParams.get("previa") === "1";
  const total = cuantosArticulos(lineas);
  if (total === 0 || enElCarrito || enElDetalle || enLaVistaPrevia) return null;

  return <CartPillButton total={total} href={`/c/${token}/carrito`} />;
}
