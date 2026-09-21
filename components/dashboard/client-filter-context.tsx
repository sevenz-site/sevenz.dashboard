"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ClientFilterChips, useClientFilters } from "@/components/dashboard/client-filters";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummary } from "@/lib/types";

// Los contextos del buscador, en su propio módulo.
//
// Viven aparte de los componentes porque si no hay un ciclo: el Combobox
// necesita `useSharedClientFilters` para leer el estado, y el buscador inline
// necesita al Combobox para pintarse. Dos archivos importándose entre sí
// funciona hasta que deja de hacerlo, y cuando falla lo hace en el bundler y
// con un mensaje que no menciona el ciclo.

// El estado completo, no solo la parte que pinta los controles: la tabla y la
// vista previa necesitan además `sortedRows` y `judgementBalance`.
export type SharedClientFilters = ReturnType<typeof useClientFilters<ClientSummary>>;

const FilterContext = createContext<SharedClientFilters | null>(null);

export function useSharedClientFilters() {
  return useContext(FilterContext);
}

// El proveedor llama al hook él mismo, no lo recibe hecho. Cartera es un
// Server Component: no puede sostener estado, así que si el hook viviera
// fuera no habría dónde ponerlo. Envolviendo la pantalla entera, el buscador
// de arriba y la lista del final comparten uno solo.
export function ClientFilterProvider({
  rows,
  rateContext,
  children,
}: {
  rows: ClientSummary[];
  rateContext: OwnerRateContext | null;
  children: React.ReactNode;
}) {
  const filters = useClientFilters(rows, rateContext);
  const [focused, setFocusedState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El retardo al salir, otra vez, y por la misma razón de siempre: el dueño
  // toca un resultado, eso desenfoca el campo, y si el botón reapareciera en
  // ese instante volvería a ocupar el sitio donde el dedo ya está bajando.
  // Justo el error que este cambio existe para evitar.
  const setFocused = useCallback((value: boolean) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (value) {
      setFocusedState(true);
      return;
    }
    timer.current = setTimeout(() => setFocusedState(false), 150);
  }, []);

  // UNA SOLA VERDAD, y es lo importante de este bloque.
  //
  // `open` se calcula aquí, no en cada consumidor. El buscador lo usa para
  // saber si pinta la lista y "Agregar movimiento" para saber si se aparta:
  // si cada uno lo dedujera por su cuenta, bastaría que uno cambiara de
  // criterio para acabar con el botón visible bajo una lista abierta, que es
  // exactamente el toque por error que queremos impedir.
  const open = focused && filters.controls.nameQuery.trim() !== "";
  const searchOpen = useMemo(() => ({ open, setFocused }), [open, setFocused]);

  return (
    <FilterContext.Provider value={filters}>
      <SearchOpenContext.Provider value={searchOpen}>{children}</SearchOpenContext.Provider>
    </FilterContext.Provider>
  );
}

// ¿Hay una lista de coincidencias abierta sobre la pantalla de Cartera?
const SearchOpenContext = createContext<{ open: boolean; setFocused: (v: boolean) => void }>({
  open: false,
  setFocused: () => {},
});

export function useSearchResultsOpen() {
  return useContext(SearchOpenContext);
}

// Lo que se aparta mientras la lista de coincidencias tapa la pantalla.
//
// Hoy, "Agregar movimiento". La lista flota justo encima de él, así que un
// toque en el último resultado que se pase unos píxeles abre el alta de un
// movimiento en vez de la ficha del cliente — y el dueño se encuentra
// escribiendo un fiado cuando lo que quería era mirar una cuenta.
export function HideWhileResults({ children }: { children: React.ReactNode }) {
  const { open } = useSearchResultsOpen();
  return open ? null : <>{children}</>;
}

// Los chips, leyendo el estado del contexto.
//
// Existe para Cartera, que es la única pantalla donde el campo de búsqueda y
// los chips están en sitios distintos del documento: el campo arriba del todo
// y los chips abajo, pegados a la lista que ordenan. En las otras tres van
// juntos y `ClientSearchInline` los pinta él mismo.
//
// La página es un Server Component y no puede leer el contexto, de ahí este
// envoltorio de una línea.
export function ClientFilterChipsRow({ className }: { className?: string }) {
  const filters = useSharedClientFilters();
  if (!filters) return null;
  return <ClientFilterChips filters={filters} className={className} />;
}
