"use client";

import { createContext, useContext } from "react";

// El paso nuevo entra como 0 y no renumerando, a propósito. Seis sitios
// del código comparan contra el número literal de su paso
// (`tour.step === 2`, `=== 2.5`, `=== 3`...); correr la numeración los
// tocaría todos y bastaría olvidar uno para que un paso dejara de avanzar
// en silencio. Con 0 delante, ninguno cambia.
//
// Que la lista sea 0, 1, 2, 2.5, 3 es feo y se asume: el orden lo decide
// STEP_ORDER, no el valor. Si algún día hay que tocarlos de verdad, lo que
// toca es cambiarlos por nombres ("importar", "agregar"...), no seguir
// buscando huecos entre enteros.
// El recorrido son tres pasos: importar, agregar un cliente y abrir una
// ficha. El 2.5 (registrar un movimiento dentro de la ficha) y el 3
// (Importar desde el menú lateral) se retiraron el 2026-09-20 — el 3 decía
// lo mismo que el 0 desde que este existe.
export type TourStep = 0 | 1 | 2;

export type TourContextValue = {
  step: TourStep | null;
  advance: () => void;
  restart: () => void;
};

export const TourContext = createContext<TourContextValue>({
  step: null,
  advance: () => {},
  restart: () => {},
});

export function useTour() {
  return useContext(TourContext);
}
