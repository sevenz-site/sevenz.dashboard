"use client";

import { useCallback, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────
// PULSACIÓN LARGA, Y TODO LO QUE HAY QUE DESACTIVAR PARA QUE FUNCIONE EN iOS
//
// CT-21: la selección múltiple entra con una pulsación larga sobre un
// movimiento. El gesto es de dos líneas; lo que cuesta es lo demás.
//
// ─────────────────────────────────────────────────────────────────────────
// 1. SI EL DEDO SE MUEVE, NO ERA UNA PULSACIÓN: ERA UN SCROLL
//
// Es el fallo clásico y en un teléfono se da constantemente — la lista de
// movimientos de una libreta no cabe en pantalla, así que el gesto normal sobre
// ella es arrastrar. Sin un umbral de movimiento, cada scroll que empiece sobre
// una fila y tarde medio segundo abriría el modo selección.
//
// `touch-action` se deja como está a propósito: ponerlo en `none` matar
// el scroll de la lista, que es justo lo contrario de lo que hace falta. El
// gesto se cancela mirando el movimiento, no bloqueándolo.
const UMBRAL_PX = 10;

// 500 ms, el mismo que usan Android e iOS para su propia pulsación larga. Un
// valor propio haría que el gesto se sintiera distinto al del resto del
// teléfono, y este es un gesto que se aprende por costumbre, no leyendo.
const MS = 500;

export function useLongPress(alDispararse: () => void, activo = true) {
  const temporizador = useRef<number | null>(null);
  const origen = useRef<{ x: number; y: number } | null>(null);
  // El gesto ya disparó: el `click` que viene detrás se tiene que tragar, o
  // mantener pulsado un movimiento abriría el modo selección Y su hoja de
  // edición a la vez.
  const disparado = useRef(false);

  const cancelar = useCallback(() => {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    origen.current = null;
  }, []);

  useEffect(() => cancelar, [cancelar]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Solo el botón principal. Con el derecho, el navegador ya tiene su propio
      // menú y competir con él no lleva a nada bueno.
      if (e.button !== 0) return;
      if (!activo) return;
      disparado.current = false;
      origen.current = { x: e.clientX, y: e.clientY };
      temporizador.current = window.setTimeout(() => {
        disparado.current = true;
        temporizador.current = null;
        // Un toque de respuesta donde el teléfono lo permita. No es adorno: sin
        // él, el único acuse de recibo de un gesto que no se ve es que la
        // pantalla cambie, y si el dueño no estaba mirando no se entera de que
        // acaba de entrar en otro modo.
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(10);
          } catch {
            // Un navegador que lo expone y lo rechaza —o una política de
            // permisos— no puede tumbar la selección.
          }
        }
        alDispararse();
      }, MS);
    },
    [activo, alDispararse],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const o = origen.current;
      if (!o) return;
      if (Math.abs(e.clientX - o.x) > UMBRAL_PX || Math.abs(e.clientY - o.y) > UMBRAL_PX) cancelar();
    },
    [cancelar],
  );

  // ───────────────────────────────────────────────────────────────────────
  // 2. iOS SAFARI HACE LO SUYO ENCIMA, Y HAY QUE APAGARLO UNO A UNO
  //
  // Mantener pulsado en iOS abre el menú de "Copiar / Buscar" y empieza a
  // seleccionar texto. Las dos cosas pasan ANTES de que nuestro temporizador
  // llegue a los 500 ms, así que sin apagarlas el gesto no es que funcione mal:
  // es que no llega a existir, y encima deja al dueño con medio renglón
  // resaltado en azul y un menú que él no pidió.
  //
  //   WebkitTouchCallout  el menú de iOS
  //   userSelect          el resaltado de texto al arrastrar
  //   onContextMenu       el menú del navegador en escritorio, y el de Android
  //
  // No se puede comprobar aquí: no hay iPhone en este entorno. Queda escrito
  // para que quien lo pruebe en uno sepa qué mirar si falla.
  const estiloSinMenuNativo = {
    WebkitTouchCallout: "none",
    WebkitUserSelect: "none",
    userSelect: "none",
  } as const;

  return {
    // `yaDisparo` lo consulta el `onClick` de quien use esto, para no hacer su
    // acción normal cuando el toque acabó siendo una pulsación larga.
    yaDisparo: () => disparado.current,
    props: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelar,
      onPointerCancel: cancelar,
      onPointerLeave: cancelar,
      onContextMenu: (e: React.MouseEvent) => {
        if (activo) e.preventDefault();
      },
      style: activo ? estiloSinMenuNativo : undefined,
    },
  };
}
