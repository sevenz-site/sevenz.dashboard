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
const TIPOS = [
  { value: "todos", label: "Todos" },
  { value: "charge", label: "Fiado" },
  { value: "payment", label: "Abono" },
] as const;

export type TipoFiltro = (typeof TIPOS)[number]["value"];

export function MovementTypeFilter({
  tipo,
  setTipo,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
}) {
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
            {TIPOS.map((opt) => (
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
