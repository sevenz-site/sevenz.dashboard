"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import { CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { useSharedClientFilters } from "@/components/dashboard/client-filter-context";
import { cn } from "@/lib/utils";
import { track } from "@/lib/mixpanel";
import { clientHref } from "@/lib/client-origin";
import { formatDocumentId } from "@/lib/format";
import type { ClientFilterState } from "@/components/dashboard/client-filters";
import type { ClientSummary } from "@/lib/types";

// El campo de búsqueda de clientes, con las coincidencias debajo.
//
// Cada fila es nombre + documento, igual que el diálogo de "Agregar
// movimiento": el nombre solo no basta cuando en el barrio hay tres Marías, y
// el documento es lo que las distingue. Elegir una abre su ficha.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ cmdk Y NO EL Combobox DE BASE UI
//
// El de Base UI monta su lista en un portal hermano. Un Dialog modal de Radix
// —y `Sheet` es Radix Dialog, que es donde vive el buscador de Cartera— apaga
// `pointer-events` en el <body> y solo los reenciende dentro de su propio
// contenido. Ese portal queda fuera, hereda el apagado, y tocar un cliente
// tocaba el chip de detrás. Se veía perfecto y con teclado funcionaba: fallaba
// solo con el dedo, o sea en el teléfono.
//
// cmdk no monta nada aparte: la lista es un div normal debajo del campo.
//
// ─────────────────────────────────────────────────────────────────────────
// Y POR QUÉ LA LISTA NO VA EN UN Popover DE RADIX
//
// Era la idea inicial, copiando al selector de país. No sirve aquí, y la razón
// es concreta: `PopoverContent` monta en un portal, y cmdk busca sus items
// dentro de su propia raíz del DOM. El selector de país no lo sufre porque
// mete el `Command` ENTERO dentro del popover, input incluido. Aquí el campo
// tiene que quedarse en la pantalla, así que partirlos dejaría a cmdk sin ver
// sus propios items: adiós flechas, Enter y "sin resultados".
//
// Sin portal, además, el fallo de arriba no puede volver por otra puerta: no
// hay nada fuera del árbol a lo que Radix pueda apagarle los eventos.
//
// El precio es que no hay detección de colisiones: la lista siempre cae hacia
// abajo. Se acota con scroll propio, y en las cuatro pantallas el campo está
// arriba, así que hay sitio.
//
// ─────────────────────────────────────────────────────────────────────────
// QUIÉN FILTRA. Nosotros: `shouldFilter={false}`.
//
// cmdk filtra por su cuenta puntuando cada item contra la consulta, y no sabe
// nada de los chips (Estado, Monto), que viven en `useClientFilters`. Con
// "Estado: plazo vencido" puesto, su lista enseñaría clientes que la pantalla
// de detrás ya había descartado — dos respuestas a la misma pregunta sobre el
// mismo dinero. Recibe `sortedRows`, ya filtrado y ordenado.

// Cuántas coincidencias se enseñan. Más que esto y la lista tapa la pantalla
// en un teléfono; el dueño afina la búsqueda antes de recorrer treinta filas.
const MAX_RESULTADOS = 8;

export function ClientSearchCombobox({
  filters: filtersProp,
  source,
  placeholder = "Buscar cliente",
  autoFocus,
  className,
}: {
  filters?: ClientFilterState & { sortedRows: ClientSummary[] };
  // De qué pantalla salió la búsqueda, para la analítica y para que la flecha
  // de volver de la ficha regrese aquí.
  source: "cartera" | "malas_pagas" | "clientes" | "papelera";
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const fromContext = useSharedClientFilters();
  const [focused, setFocused] = useState(false);
  const filters = filtersProp ?? fromContext;
  if (!filters) return null;

  const c = filters.controls;
  const rows = filters.sortedRows;
  const visibles = rows.slice(0, MAX_RESULTADOS);

  // Solo con el campo enfocado y algo escrito. Abrirla al enfocar, vacía,
  // taparía la lista de la pantalla con una copia de sí misma.
  const abierta = focused && c.nameQuery.trim() !== "";

  function abrir(row: ClientSummary) {
    track("Client Details Opened", { client_id: row.client_id, source });
    setFocused(false);
    router.push(clientHref(row.client_id, source));
  }

  return (
    <CommandPrimitive
      shouldFilter={false}
      // `relative` para anclar la lista, y sin el `overflow-hidden` que trae
      // nuestro <Command>: recortaría justo lo que cuelga por debajo.
      className={cn("relative w-full", className)}
    >
      <div className="relative">
        {/* 40px, la altura de buscador del sistema de diseño. Las clases van
            aquí en vez de reutilizar <CommandInput> porque ese está pensado
            para dentro de una paleta: viene envuelto en padding y clavado a
            32px. `text-base` en teléfono no es cosmético — iOS Safari hace
            zoom al enfocar cualquier campo por debajo de 16px. */}
        <CommandPrimitive.Input
          autoFocus={autoFocus}
          value={c.nameQuery}
          onValueChange={c.setNameQuery}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          // Sin el retardo, el blur llega antes que el clic en un resultado y
          // la lista se desmonta bajo el dedo. Los items ya evitan robar el
          // foco, pero un toque en el borde de la lista sí lo quita.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 pr-9 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30"
        />
        {c.nameQuery ? (
          <button
            type="button"
            onClick={() => c.setNameQuery("")}
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

      {abierta ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <CommandList>
            <CommandEmpty>Ningún cliente coincide con estos filtros.</CommandEmpty>
            {visibles.map((row) => (
              <CommandItem
                key={row.client_id}
                value={row.client_id}
                // preventDefault en mousedown: sin esto el campo pierde el
                // foco antes de que el clic llegue a soltarse, la lista se
                // cierra y el toque no selecciona nada.
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => abrir(row)}
                className="cursor-pointer"
              >
                <span className="truncate">{row.name}</span>
                {row.document_id ? (
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDocumentId(row.document_id)}
                  </span>
                ) : null}
              </CommandItem>
            ))}
            {/* Decir cuántos quedan fuera, no solo cortar: ocho filas sin más
                son indistinguibles de "estos son todos", y el dueño dejaría de
                buscar creyendo que el cliente que falta no existe. */}
            {rows.length > visibles.length ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Mostrando {visibles.length} de {rows.length}. Afina la búsqueda.
              </p>
            ) : null}
          </CommandList>
        </div>
      ) : null}
    </CommandPrimitive>
  );
}
