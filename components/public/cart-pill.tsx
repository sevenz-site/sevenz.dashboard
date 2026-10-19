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
  const searchParams = useSearchParams();

  const enElCarrito = pathname === `/c/${token}/carrito`;
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
  if (total === 0 || enElCarrito || enLaVistaPrevia) return null;

  return <CartPillButton total={total} href={`/c/${token}/carrito`} />;
}
