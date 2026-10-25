"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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

  // ── EL INTERRUPTOR SE APAGA SOLO SI NADIE LO APAGA ──────────────────
  //
  // REPORTADO POR EL DUEÑO EL 2026-10-25, desde PRODUCCIÓN, y descrito como
  // un fallo del catálogo: *«en ocasiones el botón flotante "Crear producto"
  // se desaparece al igual que el navbar (…) debo salirme y volver a entrar
  // (…) no siempre resuelve el problema a la primera»*.
  //
  // NO ERA DEL CATÁLOGO. Este `focused` lo encienden los buscadores de
  // CLIENTES (Inicio y Cartera) y lo lee `mobile-nav.tsx`, que esconde la
  // barra Y el flotante mientras se busca --decisión del 2026-10-18, para que
  // no tapen el primer resultado--. Y este proveedor vive en
  // `app/(app)/layout.tsx`, o sea POR ENCIMA de todas las pantallas: si se
  // queda encendido en Inicio, el catálogo aparece sin barra y sin botón sin
  // que nada en el catálogo tenga la culpa.
  //
  // POR QUÉ SE QUEDABA ENCENDIDO: sólo se apagaba en `onBlur`. **Quitar del
  // DOM un elemento enfocado no dispara ningún evento** --ni `blur` ni
  // `focusout`, por especificación-- así que navegar con el campo enfocado lo
  // dejaba encendido para el resto de la sesión. Es la misma lección que
  // `use-keyboard-open.ts` ya tenía escrita en su versión 2: «el foco
  // sobrevive», y mirarlo a secas deja una pantalla muerta.
  //
  // Y POR QUÉ RECARGAR NO SIEMPRE LO ARREGLABA: salir y volver es navegación
  // de cliente, que no desmonta este proveedor. Una recarga entera sí lo
  // reinicia -- salvo que el navegador devuelva el foco al buscador al
  // restaurar la página, que es cuando hay que recargar dos veces.
  //
  // ── POR QUÉ UN RELOJ Y NO UN `focusout` ───────────────────────────
  //
  // Porque el caso que falla es justo el que NO emite evento. Un oyente de
  // `focusout` no se entera de un elemento que desaparece.
  //
  // Y NO PUEDE IR MÁS RÁPIDO QUE LOS 180ms DE ARRIBA. Ese retardo existe para
  // que un toque sobre un resultado se resuelva antes de que la pantalla se
  // recoloque; apagar esto en cuanto el foco sale del campo reintroduciría
  // aquel fallo --abrir la ficha del cliente equivocado-- por otra puerta.
  // 500ms está cómodamente por encima, y sólo corre mientras el interruptor
  // está encendido, que es mientras el dueño está buscando.
  useEffect(() => {
    if (!focused) return;
    const sigueEnUnCampo = (): boolean => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    };
    const reloj = setInterval(() => {
      if (!sigueEnUnCampo()) setFocusedState(false);
    }, 500);
    return () => clearInterval(reloj);
  }, [focused]);

  const value = useMemo(() => ({ focused, setFocused }), [focused, setFocused]);

  return <SearchFocusContext.Provider value={value}>{children}</SearchFocusContext.Provider>;
}

// Lo que se aparta mientras se busca.
//
// Hoy es solo el subtítulo. El título se queda: es lo que dice en qué
// pantalla estás, y perderlo al escribir desorienta más de lo que el par de
// líneas que ocupa llega a estorbar. En Papelera son tres líneas y se nota;
// en Clientes es una sola y casi no, pero se aplica igual en las tres para
// que las tres se comporten igual.
//
// Envuelve en vez de que cada página se apañe sola porque las tres son Server
// Components y no pueden leer el contexto.
//
// `hidden` y no una altura animada: animar la salida desplaza la lista
// mientras el dueño ya está leyendo, y en un teléfono barato esa animación se
// ve a trompicones. Desaparecer de golpe es más honesto.
export function HideWhileSearching({ children }: { children: React.ReactNode }) {
  const { focused } = useSearchFocus();
  // Solo en teléfono. De md hacia arriba sobra sitio y no hay teclado que se
  // coma media pantalla, así que apartar algo solo movería la página sin
  // ganar nada.
  return <div className={focused ? "hidden md:block" : undefined}>{children}</div>;
}
