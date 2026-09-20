"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useSharedClientFilters } from "@/components/dashboard/client-filter-context";
import { track } from "@/lib/mixpanel";
import { clientHref } from "@/lib/client-origin";
import { formatDocumentId } from "@/lib/format";
import type { ClientFilterState } from "@/components/dashboard/client-filters";
import type { ClientSummary } from "@/lib/types";

// El campo de búsqueda de clientes, con las coincidencias en un Combobox.
//
// Cada fila es nombre + documento, igual que el diálogo de "Agregar
// movimiento": el nombre solo no basta cuando en el barrio hay tres Marías, y
// el documento es lo que las distingue.
//
// ─────────────────────────────────────────────────────────────────────────
// QUIÉN FILTRA. Nosotros, no el Combobox: `filter={null}`.
//
// Base UI filtra su lista por su cuenta comparando la consulta con el texto de
// cada item. Si lo dejáramos, filtraría DOS veces sobre datos distintos: los
// chips (Estado, Monto) viven en `useClientFilters` y el Combobox no sabe nada
// de ellos. Con "Estado: plazo vencido" puesto, su lista enseñaría clientes que
// la pantalla de detrás ya había descartado — dos respuestas a la misma
// pregunta sobre el mismo dinero.
//
// Así que le pasamos `sortedRows`, que ya viene filtrado y ordenado por el
// estado compartido, y le quitamos el filtro propio. Una sola verdad.
//
// ─────────────────────────────────────────────────────────────────────────
// NO HAY SELECCIÓN QUE GUARDAR. `value={null}`, siempre.
//
// Un combobox normalmente deja elegido lo que tocas y lo escribe en el campo.
// Aquí elegir significa ABRIR la ficha de ese cliente, así que no hay nada que
// dejar seleccionado: se navega y el campo se queda como estaba. Mantenerlo
// controlado en null impide que el componente reescriba la búsqueda con el
// nombre del cliente al volver atrás.

export function ClientSearchCombobox({
  filters: filtersProp,
  source,
  placeholder = "Buscar cliente",
  autoFocus,
  className,
  onNavigate,
}: {
  filters?: ClientFilterState & { sortedRows: ClientSummary[] };
  // De qué pantalla salió la búsqueda, para la analítica del clic.
  source: "cartera" | "malas_pagas" | "clientes" | "papelera";
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  // Cartera lo usa para cerrar su hoja antes de navegar.
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const fromContext = useSharedClientFilters();
  const filters = filtersProp ?? fromContext;
  if (!filters) return null;

  const c = filters.controls;
  const rows = filters.sortedRows;

  return (
    <Combobox
      items={rows}
      filter={null}
      value={null}
      itemToStringValue={(row: ClientSummary) => row.name}
      inputValue={c.nameQuery}
      onInputValueChange={(value) => c.setNameQuery(value)}
      onValueChange={(row) => {
        if (!row) return;
        const picked = row as ClientSummary;
        track("Client Details Opened", { client_id: picked.client_id, source });
        onNavigate?.();
        router.push(clientHref(picked.client_id, source));
      }}
    >
      {/* showTrigger={false}: el chevron de un combobox promete un desplegable
          con opciones fijas. Aquí no hay lista que desplegar hasta que se
          escribe, así que abrirlo vacío solo enseña "Ningún cliente coincide".
          showClear sí, que es la aspa de borrar que ya tenía el campo. */}
      <ComboboxInput
        autoFocus={autoFocus}
        placeholder={placeholder}
        showTrigger={false}
        showClear
        // h-10 sobre el InputGroup, que trae h-8. Los 40px son la regla
        // del sistema de diseño para los buscadores; sin esto el
        // Combobox los devolvería a 32 sin que nadie lo pidiera.
        className={cn("h-10", className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>Ningún cliente coincide con estos filtros.</ComboboxEmpty>
        <ComboboxList>
          {(row: ClientSummary) => (
            <ComboboxItem key={row.client_id} value={row}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">{row.name}</span>
                {row.document_id ? (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDocumentId(row.document_id)}
                  </span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
