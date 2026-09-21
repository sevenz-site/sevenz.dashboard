"use client";

import { useCallback, useEffect, useRef } from "react";

// La trampa para el botón atrás del teléfono, cuando una pantalla tiene algo
// que perder.
//
// Next no descarga la página en una navegación de historial, así que
// `beforeunload` no se entera: ni el botón físico de Android, ni el gesto de
// deslizar del iPhone, ni el atrás del navegador. La única forma de
// interceptarlos es dejar una entrada CENTINELA en el historial y reaccionar
// cuando se consume.
//
// Vivía dentro de business-settings-form.tsx. Se sacó aquí el 2026-09-20 al
// necesitarlo también la revisión de una libreta importada: dos copias de una
// manipulación del historial con este nivel de sutileza es exactamente como
// aparece el próximo fallo, y el que ya se arregló una vez —el que explica el
// comentario de `hayCentinela`— habría que volver a arreglarlo dos veces.
//
// ─────────────────────────────────────────────────────────────────────────
// EL FALLO QUE `hayCentinela` ARREGLA, porque no es evidente:
//
// Salir por el menú lateral es un `router.push` hacia delante, no un atrás, así
// que NO dispara este manejador. El centinela se quedaba abandonado debajo de
// la página siguiente, y pulsar atrás desde allí devolvía al formulario que se
// acababa de dejar. Por eso `consumir()` se puede llamar desde dos sitios y es
// idempotente.

export function useTrampaDeAtras(
  activa: boolean,
  guard: (proceed: () => void) => void,
) {
  const hayCentinela = useRef(false);
  const manejadorRef = useRef<(() => void) | null>(null);

  // Se pasa como `onBeforeLeave` al guard: cualquier salida, venga por donde
  // venga, tiene que limpiar el centinela antes de que la navegación ocurra.
  const consumir = useCallback(() => {
    if (!hayCentinela.current) return;
    hayCentinela.current = false;
    if (manejadorRef.current) {
      window.removeEventListener("popstate", manejadorRef.current);
      manejadorRef.current = null;
    }
    return new Promise<void>((resolve) => {
      function alVolver() {
        window.removeEventListener("popstate", alVolver);
        resolve();
      }
      window.addEventListener("popstate", alVolver);
      history.back();
    });
  }, []);

  useEffect(() => {
    if (!activa) return;
    history.pushState(null, "", location.href);
    hayCentinela.current = true;

    function alRetroceder() {
      // Se repone el centinela ANTES de preguntar: si el dueño decide
      // quedarse, la trampa tiene que seguir armada para el siguiente atrás.
      history.pushState(null, "", location.href);
      hayCentinela.current = true;
      guard(() => {
        manejadorRef.current = null;
        consumir();
      });
    }

    manejadorRef.current = alRetroceder;
    window.addEventListener("popstate", alRetroceder);
    return () => {
      window.removeEventListener("popstate", alRetroceder);
      manejadorRef.current = null;
    };
  }, [activa, guard, consumir]);

  return consumir;
}
