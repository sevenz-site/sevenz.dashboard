"use client";

import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDocumentId } from "@/lib/format";
import { MALA_PAGA_BADGE_CLASS } from "@/lib/types";

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

export type ClientResult = {
  id: string;
  name: string;
  documentId: string | null;
  // Su letra. Sin valor por defecto: las dos pantallas que arman esta lista
  // —el buscador de Cartera y el de la venta— tienen que mandarla.
  documentType: string | null;
  // ── SI ESTÁ EN LA LISTA NEGRA DEL TENDERO ─────────────────────────
  //
  // OPCIONAL, y por eso se añade aquí en vez de copiar la lista: los dos
  // buscadores que ya la usan no lo mandan y siguen igual. El que sí lo
  // manda es la elección de ficha del flujo de pedidos (`PR-E3`,
  // 2026-10-26), donde la marca ES la razón de la pantalla: varias fichas
  // comparten los dígitos y lo único que de verdad las distingue, para
  // decidir si se fía, es cuál de ellas no paga.
  //
  // Sin esto habría que elegir a ciegas y enterarse DESPUÉS, en el diálogo
  // del último toque — justo el orden que `PR-E6` existe para evitar.
  flagged?: boolean;
};

// Ocho. Es lo que el diálogo lleva usando desde siempre y lo que cabe en un
// teléfono sin tapar la pantalla entera; con más, el dueño afina la búsqueda
// antes de ponerse a recorrer la lista.
export const CLIENT_RESULT_LIMIT = 8;

// ═══════════════════════════════════════════════════════════════════════
// DOS FORMAS, UN SOLO COMPONENTE
//
// `lista` es la de siempre: filas pegadas dentro de un borde, para colgar de
// un campo de busqueda mientras se teclea.
//
// `tarjetas` es el frame `1770:14775`, pedido por el dueno el 2026-10-28 para
// la pantalla de documentos repetidos: cada ficha en su propia tarjeta, con el
// documento debajo del nombre, el chip abajo y un boton «Seleccionar» a la
// derecha.
//
// POR QUE UNA VARIANTE Y NO UN COMPONENTE NUEVO. Este fichero ya dice por que
// existe: *«dos copias de una lista de personas y cedulas se separan en cuanto
// alguien retoca una»*. Esa razon no cambia porque una de las dos se vea
// distinta -- lo que no puede divergir es QUE datos identifican a una persona
// y como se escriben, y eso sigue viviendo aqui una sola vez.
//
// LO QUE CAMBIA DE VERDAD ENTRE LAS DOS, y conviene saberlo antes de tocarlas:
// en `lista` el control es la FILA ENTERA; en `tarjetas` es el boton, porque
// es lo que el frame dibuja. El area de toque se encoge --40px de alto en vez
// de toda la fila-- y a cambio la tarjeta puede llevar tres lineas de datos
// sin que el dedo tenga que adivinar donde empieza y acaba cada ficha.
export function ClientResultList({
  results,
  onSelect,
  className,
  variant = "lista",
}: {
  results: ClientResult[];
  onSelect: (id: string) => void;
  className?: string;
  variant?: "lista" | "tarjetas";
}) {
  if (results.length === 0) return null;

  if (variant === "tarjetas") {
    return (
      <ul className={`flex flex-col gap-3 ${className ?? ""}`}>
        {results.map((c) => (
          <li
            key={c.id}
            // `rounded-[10px]` y `px-4 py-2` son los del frame.
            className="flex items-center gap-3 rounded-[10px] border px-4 py-2"
          >
            <UserRound className="size-6 shrink-0 text-muted-foreground" aria-hidden />
            {/* `min-w-0` EN LA COLUMNA, o un nombre largo empuja al boton
                fuera de la tarjeta en vez de recortarse. Es el fallo que
                `truncate` no arregla solo dentro de un flex. */}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium">{c.name}</span>
              {c.documentId ? (
                <span className="truncate text-xs text-muted-foreground">
                  {formatDocumentId(c.documentId, c.documentType)}
                </span>
              ) : null}
              {/* SOLO SI ESTA MARCADA, que es lo que dice el frame: sus
                  tarjetas sin chip miden 57px y las marcadas 77. El chip no
                  es el estado del cliente -- es la marca del tendero. */}
              {c.flagged ? (
                <span className="flex">
                  <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                    Mala paga
                  </Badge>
                </span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(c.id)}
            >
              Seleccionar
            </Button>
          </li>
        ))}
      </ul>
    );
  }

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
            {/* EL CHIP ANTES DEL DOCUMENTO, no al final: el documento es lo
                que TODAS comparten en la pantalla que lo manda, así que es la
                columna que menos se mira. */}
            {c.flagged ? (
              <Badge
                variant="outline"
                className={`${MALA_PAGA_BADGE_CLASS} ml-auto shrink-0`}
              >
                Mala paga
              </Badge>
            ) : null}
            {c.documentId ? (
              <span
                className={`${c.flagged ? "ml-2" : "ml-auto"} shrink-0 text-xs text-muted-foreground`}
              >
                {formatDocumentId(c.documentId, c.documentType)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
