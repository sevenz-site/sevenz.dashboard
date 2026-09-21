"use client";

import { Search, X } from "lucide-react";
import {
  ClientFilterChips,
  type ClientFilterState,
} from "@/components/dashboard/client-filters";
import { useSharedClientFilters } from "@/components/dashboard/client-filter-context";
import { useSearchFocus } from "@/components/dashboard/search-focus-context";
import type { ClientSummary } from "@/lib/types";

// El buscador de clientes con la lista a la vista: Clientes, Malas pagas y
// Papelera.
//
// Campo y chips en la propia pantalla, y NADA que se despliegue: el resultado
// son las tarjetas de abajo, que se filtran mientras se escribe.
//
// Cartera no usa esto. Allí la lista queda al final del documento, detrás de
// las tarjetas de capital y la tira de tasas, así que escribir y no ver nada
// cambiar se lee como que el buscador está roto: su campo enseña las
// coincidencias debajo, y vive en `client-search-cartera.tsx`.
//
// La regla no es "con desplegable" o "sin él": es si el resultado se ve desde
// donde estás escribiendo.
//
// EL ESTADO ES EL DE SIEMPRE: `useClientFilters`, el mismo que usan las cuatro
// pantallas. Aquí no se filtra nada nuevo; solo cambia dónde se toca.
// El campo llano de las tres pantallas con la lista a la vista.
//
// Un <input> de toda la vida, sin cmdk: no hay ninguna lista que recorrer con
// las flechas, porque el resultado son las tarjetas de la pantalla. La única
// consecuencia es que Enter aquí no hace nada, que es lo correcto cuando no
// hay nada resaltado que abrir.
//
// Las clases se escriben aquí en vez de usar <Input>, que mide 32px: el
// buscador va a 40 por la regla del sistema de diseño. `text-base` en teléfono
// no es cosmético — iOS Safari hace zoom al enfocar un campo por debajo de
// 16px.
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  // Mientras se escribe, el título de la pantalla se aparta para dejar
  // sitio a la lista. Ver search-focus-context.tsx.
  const { setFocused } = useSearchFocus();

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 pr-9 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Borrar búsqueda"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : (
        <Search
          aria-hidden="true"
          className="absolute top-1/2 right-3 -translate-y-1/2 size-4 text-muted-foreground"
        />
      )}
    </div>
  );
}

// La forma por defecto: Clientes, Malas pagas y Papelera.
export function ClientSearchInline({
  filters: filtersProp,
  placeholder = "Buscar cliente",
  className,
}: {
  // Lo mínimo que el buscador necesita, NO `SharedClientFilters`. Ese tipo
  // fija las filas a `ClientSummary` y Papelera pasa `ClientSummaryAll`, que
  // lleva además el saldo del día en que se ocultó. Pedir de más aquí
  // dejaría fuera a la única pantalla con filas propias.
  filters?: ClientFilterState & { sortedRows: ClientSummary[] };
  placeholder?: string;
  className?: string;
}) {
  const fromContext = useSharedClientFilters();
  const filters = filtersProp ?? fromContext;
  if (!filters) return null;

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <SearchField
        value={filters.controls.nameQuery}
        onChange={filters.controls.setNameQuery}
        placeholder={placeholder}
      />
      <ClientFilterChips filters={filters} />
    </div>
  );
}
