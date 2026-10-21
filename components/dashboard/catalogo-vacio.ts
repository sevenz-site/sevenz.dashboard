"use client";

import { useSyncExternalStore } from "react";

// ¿ESTÁ EL CATÁLOGO ENSEÑANDO SU ESTADO VACÍO?
//
// Lo produce `CatalogTable`, que es la única que lo sabe, y lo consume la
// barra de abajo para esconder su botón flotante de «Crear producto».
//
// Instrucción del dueño el 2026-10-20, marcada por él como importante:
// *«mientras el empty state sea visible en esa pantalla, el botón flotante de
// "Crear producto" no será visible»*. Y tiene razón: desde ese día el estado
// vacío lleva su propio botón de ancho completo (frame `1500:9705`), así que
// con los dos a la vez habría DOS controles con la misma etiqueta a cinco
// centímetros, en una pantalla cuyo único contenido es pedir que uses uno.
//
// ===========================================================================
// POR QUÉ UN ALMACÉN EXTERNO Y NO UN CONTEXTO
//
// `MobileNav` y la pantalla son HERMANOS --los monta `app/(app)/layout.tsx`
// uno al lado del otro-- así que no hay props que pasar. Un contexto sí
// podría envolver a los dos, y es lo que hace `revision-en-curso.tsx`... pero
// ese se escribe desde MANEJADORES, nunca al pintar. Su propio comentario lo
// dice, y es lo que le permite no chocar con la regla del lint.
//
// Aquí el dato se DERIVA al pintar (`total === 0`), no de un toque. Meterlo
// en un `useState` de contexto obligaría a escribirlo desde un efecto, y
// `eslint` rechaza `setState` dentro de un efecto --ya pasó dos veces esta
// semana--. Una escritura en un almacén externo NO es `setState`: es
// exactamente para lo que `useSyncExternalStore` existe, y el efecto que la
// dispara es legítimo porque sincroniza React con algo de fuera.
//
// ===========================================================================
// SE APAGA AL DESMONTAR, Y ESO NO ES OPCIONAL
//
// Si la bandera se quedara encendida al salir del catálogo, el botón
// flotante desaparecería de TODA la app hasta recargar. Es literalmente el
// fallo que `revision-en-curso.tsx` cuenta haber medido el 2026-09-21 con
// una libreta de 23 filas: el dueño sin navegación y sin nada que explique
// por qué. Por eso la limpieza va en el `return` del efecto que lo enciende.
let vacio = false;
const oyentes = new Set<() => void>();

export function marcarCatalogoVacio(v: boolean) {
  if (vacio === v) return;
  vacio = v;
  for (const o of oyentes) o();
}

function subscribe(o: () => void) {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

const leer = () => vacio;
// EL SERVIDOR SIEMPRE DICE «no». Es lo seguro: un botón que sobra un instante
// se ve; uno que falta deja al tendero sin la acción de la pantalla.
const leerEnElServidor = () => false;

export function useCatalogoVacio() {
  return useSyncExternalStore(subscribe, leer, leerEnElServidor);
}
