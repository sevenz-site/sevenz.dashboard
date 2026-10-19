"use client";

import { useEffect, useState } from "react";

// ¿ESTÁ EL TECLADO DEL TELÉFONO LEVANTADO?
//
// Lo miran las dos barras que se pegan al borde inferior: la de navegación
// (`mobile-nav.tsx`) y la de botones del flujo de registrar
// (`sticky-actions.tsx`). Con el teclado abierto las dos se quedan flotando
// encima de él, tapando el campo que el tendero está rellenando — el dueño lo
// vio el 2026-10-18 con «Registrar y finalizar» sobre el campo Documento.
//
// ===========================================================================
// VIVÍA DENTRO DE `mobile-nav.tsx` HASTA ESE DÍA
//
// Se mudó aquí cuando la segunda barra lo necesitó. Copiarlo habría sido la
// tercera vez que algo del flujo de registrar se escribe dos veces en este
// repo en una semana, y las dos anteriores costaron un bug cada una: el
// buscador que no se vaciaba y el botón que no se pegó abajo.
//
// ===========================================================================
// EL VIEWPORT VISUAL ES LA ÚNICA SEÑAL FIABLE
//
// iOS no redimensiona la página cuando aparece el teclado: lo superpone, y el
// viewport VISUAL encoge mientras el de maquetación no. Esa diferencia es lo
// que se mide.
//
// Los eventos de foco parecen más directos y no sirven: disparan también con
// un botón o un `select`, y no avisan cuando el teclado se cierra solo.
//
// SIN SEÑAL, LA BARRA SE QUEDA. Una barra que sobra es cosmético; una que
// falta se lleva por delante la navegación o el botón que cierra la venta.
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return open;
}
