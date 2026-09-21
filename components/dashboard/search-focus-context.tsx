"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// ¿Está el dueño escribiendo en el buscador de clientes?
//
// Tres sitios lejanos del árbol tienen que saberlo a la vez: el campo, que lo
// produce; el título de la pantalla y la barra inferior, que se apartan; y
// `<main>`, que deja de reservar el hueco de esa barra. El campo vive dentro
// de la lista y la barra vive en el layout, así que no hay prop que los una.
//
// POR QUÉ SE APARTAN. En un teléfono, entre el título, el subtítulo, la barra
// de abajo y el teclado, al dueño le quedaban unos 250px para leer los
// clientes que acababa de buscar. El título dice "Clientes" en la pantalla de
// clientes: cuando estás buscando, es lo que menos falta hace.
//
// LA BARRA YA SE ESCONDÍA, pero por otro motivo: `useKeyboardOpen` mira si el
// viewport visual encogió. Eso funciona en un teléfono de verdad y no funciona
// con teclado físico, ni en un navegador de escritorio, ni si el sistema
// decide no encoger nada. El foco es la señal directa; la otra se queda como
// está, y la barra se aparta con cualquiera de las dos.

type SearchFocusValue = {
  focused: boolean;
  setFocused: (value: boolean) => void;
};

const SearchFocusContext = createContext<SearchFocusValue>({
  focused: false,
  setFocused: () => {},
});

export function useSearchFocus() {
  return useContext(SearchFocusContext);
}

export function SearchFocusProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocusedState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // EL RETARDO AL SALIR NO ES COSMÉTICO, y es la única parte delicada de todo
  // esto.
  //
  // El dueño toca la tarjeta de un cliente. Eso quita el foco del campo; si
  // devolviéramos título y barra en ese instante, el contenido baja unos 70px
  // ENTRE que el dedo toca y que el navegador decide sobre qué elemento fue el
  // clic. Resultado: abre la ficha del cliente de arriba. Un fallo que además
  // es invisible al probarlo con ratón, porque un clic de ratón es instantáneo.
  //
  // Recolocar solo después de que el clic se haya resuelto lo evita. Al entrar
  // no hay retardo: apartarse tiene que sentirse inmediato.
  const setFocused = useCallback((value: boolean) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (value) {
      setFocusedState(true);
      return;
    }
    timer.current = setTimeout(() => setFocusedState(false), 180);
  }, []);

  const value = useMemo(() => ({ focused, setFocused }), [focused, setFocused]);

  return <SearchFocusContext.Provider value={value}>{children}</SearchFocusContext.Provider>;
}

// El título y el subtítulo de una pantalla de lista, que se apartan mientras
// se busca.
//
// Envuelve en vez de que cada página se apañe sola porque las tres son Server
// Components y no pueden leer el contexto. Además así las tres se comportan
// igual por construcción, que es lo que fallaba cuando cada lista tenía su
// propio bloque de filtros.
//
// `hidden` y no una altura animada: animar la salida del título desplaza la
// lista mientras el dueño ya está leyendo, y en un teléfono barato esa
// animación se ve a trompicones. Desaparecer de golpe es más honesto.
export function ScreenHeader({ children }: { children: React.ReactNode }) {
  const { focused } = useSearchFocus();
  // Solo en teléfono. De md hacia arriba sobra sitio y quitar el título haría
  // que la pantalla se quedara sin saber qué es.
  return <div className={focused ? "hidden md:block" : undefined}>{children}</div>;
}
