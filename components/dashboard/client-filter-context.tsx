"use client";

import { createContext, useContext } from "react";
import { useClientFilters } from "@/components/dashboard/client-filters";
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

// Cerrar la hoja viaja por contexto, NO como prop.
//
// La versión anterior pasaba `children` como funcion `(close) => ...` para que
// la vista previa pudiera cerrarse al abrir un cliente. Compila y revienta en
// ejecución: Cartera es un Server Component y React no puede serializar una
// función a través de esa frontera — "Functions are not valid as a child of
// Client Component", un 500 en la pantalla principal. El typecheck no lo ve
// porque no es un error de tipos.
const CloseContext = createContext<() => void>(() => {});

export function SearchSheetCloseProvider({
  close,
  children,
}: {
  close: () => void;
  children: React.ReactNode;
}) {
  return <CloseContext.Provider value={close}>{children}</CloseContext.Provider>;
}

export function useCloseSearchSheet() {
  return useContext(CloseContext);
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
  return <FilterContext.Provider value={filters}>{children}</FilterContext.Provider>;
}
