"use client";

import { UserRound } from "lucide-react";
import { formatDocumentId } from "@/lib/format";

// La lista de coincidencias al buscar un cliente: nombre + documento.
//
// Dos sitios la pintan y tiene que ser LA MISMA, no una parecida: el diálogo
// que abre "Agregar movimiento" y el buscador de Cartera. Vivía como marcado
// suelto dentro del diálogo; se extrajo aquí el 2026-09-20 al llevarla también
// a Cartera, porque dos copias de una lista de personas y cédulas se separan
// en cuanto alguien retoca una.
//
// El documento no es decoración. Con tres Marías en el mismo barrio, el nombre
// solo no distingue a ninguna, y equivocarse aquí significa apuntarle un fiado
// a quien no es.

export type ClientResult = { id: string; name: string; documentId: string | null };

// Ocho. Es lo que el diálogo lleva usando desde siempre y lo que cabe en un
// teléfono sin tapar la pantalla entera; con más, el dueño afina la búsqueda
// antes de ponerse a recorrer la lista.
export const CLIENT_RESULT_LIMIT = 8;

export function ClientResultList({
  results,
  onSelect,
  className,
}: {
  results: ClientResult[];
  onSelect: (id: string) => void;
  className?: string;
}) {
  if (results.length === 0) return null;

  return (
    <ul className={`flex flex-col divide-y rounded-md border ${className ?? ""}`}>
      {results.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            // preventDefault en mousedown: cuando esta lista cuelga de un
            // campo que puede perder el foco —el buscador de Cartera—, sin
            // esto el campo se desenfoca, la lista se desmonta y el toque no
            // llega a seleccionar nada. En el diálogo no hace falta y no
            // molesta.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(c.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{c.name}</span>
            {c.documentId ? (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatDocumentId(c.documentId)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
