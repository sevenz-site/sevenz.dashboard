"use client";

import { createContext, useContext } from "react";
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
  return <FilterContext.Provider value={filters}>{children}</FilterContext.Provider>;
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
