"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// ¿Está el dueño escribiendo en el buscador de clientes?
//
// Lo produce el campo y lo consume el título de la pantalla, que se aparta
// mientras se busca. Son dos puntos lejanos: el campo vive dentro de la lista
// y el título lo pinta cada página, que además es un Server Component. De ahí
// el contexto y no una prop.
//
// POR QUÉ SE APARTA. En un teléfono, entre el título, el subtítulo, la barra
// de abajo y el teclado, al dueño le quedaban unos 250px para leer los
// clientes que acababa de buscar. El título dice "Clientes" en la pantalla de
// clientes: cuando estás buscando, es lo que menos falta hace.
//
// LA BARRA INFERIOR NO SE TOCA, decidido el 2026-09-20 después de probarlo en
// ambas versiones. Quitarla gana 64px más, pero deja al dueño sin navegación
// justo cuando más probable es que quiera salir de donde está. Se queda, y con
// ella la reserva de espacio de `AppMain`, que por eso vuelve a ser constante.
// (Aun así desaparece sola cuando sube el teclado del teléfono; de eso se
// encarga `useKeyboardOpen` en mobile-nav.tsx, y es anterior a esto.)
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
