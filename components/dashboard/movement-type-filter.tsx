"use client";

import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/dashboard/client-filters";

// THE HISTORY'S TYPE FILTER, asked for by the owner on 2026-10-16: "Todos",
// "Fiado" and "Abono", to the right of the history's title.
//
// IT LIVES IN ITS OWN FILE because BOTH histories mount it -- the shopkeeper's
// and the client's at `/s/[token]`. Until 2026-10-16 it was copied byte for
// byte into each list, and the copies were still identical only because nobody
// had touched one yet. The first edit that reached one and not the other would
// have given the same product two filters that behave differently, and the
// client's is the half nobody on this side looks at.
// «DE CONTADO» ENTRA EL 2026-10-18, a petición del dueño: las ventas pagadas
// enteras no salían en el historial, porque no escriben nada en `movements`
// (ver `lib/ventas-de-contado.ts`). Ahora el historial las mezcla, así que el
// filtro tiene que poder dejarlas solas.
//
// `cash` Y NO `sale`: lo que distingue a esa fila no es que venga de una venta
// —un fiado también— sino que se pagó entera en el momento.
const TIPOS = [
  { value: "todos", label: "Todos" },
  { value: "charge", label: "Fiado" },
  { value: "payment", label: "Abono" },
  { value: "cash", label: "De contado" },
] as const;

export type TipoFiltro = (typeof TIPOS)[number]["value"];

export function MovementTypeFilter({
  tipo,
  setTipo,
  conContado = false,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
  // UNA OPCION QUE NO FILTRA NADA ES PEOR QUE NO TENERLA. La pantalla del
  // cliente todavía no recibe las ventas de contado --su RPC no las devuelve,
  // ver `lib/ventas-de-contado.ts`-- así que allí el chip llevaría a una lista
  // vacía y a la frase «no tiene ... registrados», que sería falsa.
  conContado?: boolean;
}) {
  const opciones = conContado ? TIPOS : TIPOS.filter((t) => t.value !== "cash");
  // THE CHIP NAMES ITS VALUE, NEVER ITS FIELD. It used to read "Tipo" while
  // unfiltered, which answers "what does this control?" -- a question the
  // owner stopped asking the moment he saw it, and that the new "Filtrar por"
  // label now answers anyway. "Todos" answers the one that is actually live:
  // what am I looking at right now. Owner's decision, 2026-10-16.
  const etiqueta = TIPOS.find((t) => t.value === tipo)?.label ?? "Todos";

  return (
    // The label is a sibling of the chip, not part of it: the chip fills in
    // when a filter is on, and a highlighted "Filtrar por" would read as part
    // of the chosen value.
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtrar por</span>
      <FilterChip label={etiqueta} active={tipo !== "todos"}>
        {(close) => (
          <div className="flex flex-col gap-1">
            {opciones.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={tipo === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  setTipo(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>
    </div>
  );
}
