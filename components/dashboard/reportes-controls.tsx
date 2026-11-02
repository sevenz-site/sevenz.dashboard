"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { ClientResultList, CLIENT_RESULT_LIMIT } from "@/components/dashboard/client-result-list";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { foldForSearch } from "@/lib/search/fold";

// THE TWO CONTROLS OF /reportes, and both of them live in the URL.
//
// Not in React state: the series are bucketed on the server, so a change has to
// reach it anyway. Carrying them as `?periodo=` and `?cliente=` means the back
// button steps through what the owner looked at, a reload shows the same thing,
// and no movement row is ever shipped to the browser just so it can be filtered
// there.
//
// The cost, said out loud: every change is a round trip. On this screen that is
// a chart redrawing, not a form losing what you typed.

function useParamPush() {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // `replace` and not `push` for the period: flipping between 7 and 30 days
  // half a dozen times should not bury the previous screen under six history
  // entries. Picking a client DOES push, because backing out of it is the
  // natural way to say "show me everyone again".
  const set = (key: string, value: string | null, mode: "push" | "replace") => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router[mode](qs ? `/reportes?${qs}` : "/reportes");
    });
  };

  return { set, isPending };
}

// AQUÍ VIVÍAN LOS CHIPS DE 7 Y 30 DÍAS, hasta el 2026-10-27. Los sustituyó el
// filtro «Fecha» con calendario (`reportes-fecha.tsx`), por encargo del dueño:
// *«Cambiar filtros 7 días y 30 días por "Fecha"»*. Sus dos atajos siguen
// existiendo DENTRO de esa hoja, que es donde ahora se eligen.
//
// Se borran en vez de dejarlos sin usar: un componente exportado que nadie
// monta es el que alguien vuelve a montar dentro de un año sin saber que fue
// reemplazado.

export function ReportesClientSearch({
  clients,
  selectedName,
}: {
  clients: { id: string; name: string; document_id: string | null; document_type: string | null }[];
  // Null when no client is picked. When it is set the field stops being a
  // search box and becomes a label with a way out — typing again would suggest
  // you can stack two clients, and you cannot.
  selectedName: string | null;
}) {
  const { set } = useParamPush();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const q = foldForSearch(query.trim());
  const results =
    q === ""
      ? []
      : clients
          .filter((c) => foldForSearch(c.name).includes(q) || foldForSearch(c.document_id).includes(q))
          .slice(0, CLIENT_RESULT_LIMIT)
          .map((c) => ({
            id: c.id,
            name: c.name,
            documentId: c.document_id,
            documentType: c.document_type ?? null,
          }));

  if (selectedName) {
    return (
      <div className="flex h-[50px] w-full items-center justify-between gap-2 rounded-[10px] border-2 border-brand-field-border bg-brand-field pr-3 pl-4">
        <span className="truncate text-[17px] text-brand-secondary">{selectedName}</span>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            set("cliente", null, "push");
          }}
          aria-label="Quitar el filtro de cliente"
          className="shrink-0 rounded text-brand-secondary outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <X className="size-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* `SearchField`, el mismo de Clientes, desde el 2026-10-16. Este campo
          ya tenía exactamente su aspecto —50px, el relleno, el borde de 2px—
          porque era una copia suya, pero le faltaba la rama del aspa, así que
          la única forma de vaciarlo era borrar letra por letra. */}
      <SearchField
        tone="dark"
        value={query}
        onChange={setQuery}
        placeholder="Buscar cliente"
        onFocus={() => setFocused(true)}
        // The same delay as the other screens, and for the same reason: tapping
        // a result blurs the field, and unmounting the list in that instant
        // means the tap lands on whatever moved into its place.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />

      {focused && q !== "" ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 bg-popover shadow-md">
          <ClientResultList
            results={results}
            onSelect={(id) => {
              setQuery("");
              set("cliente", id, "push");
            }}
          />
          {results.length === 0 ? (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              Sin resultados para &quot;{query.trim()}&quot;.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL BUSCADOR DE «INVENTARIO» Y EL DE «PROVEEDORES»
//
// Frames `1667:19336` y `1749:14598`: la MISMA barra de la cabecera que ya
// usa Facturación, con otro texto dentro. Encargo del dueño el 2026-10-29.
//
// ───────────────────────────────────────────────────────────────────────
// FILTRAN LA PESTAÑA ENTERA, no solo las listas
//
// Decisión suya ese día, elegida entre tres. Es lo mismo que hace el de
// clientes: eliges un producto y TODO Inventario pasa a hablar de él. La
// pregunta que contesta es «¿cómo va este producto?», no «¿dónde está?».
//
// CONSECUENCIA QUE HAY QUE SABER: con un producto elegido las tres tarjetas
// dicen 1/0/0 o 0/1/0 -- son un recuento de productos y solo queda uno. No es
// un fallo; es lo que un filtro de uno significa. La línea «Mostrando solo X»
// de la pantalla es lo único que lo explica, igual que en Facturación.
//
// ───────────────────────────────────────────────────────────────────────
// UN SOLO COMPONENTE PARA LOS DOS, Y NO UNA COPIA DEL DE CLIENTES
//
// El de clientes no vale tal cual: busca además por documento y su lista de
// resultados pinta cédula y tipo. Éste busca por nombre y ya. Lo que sí
// comparte es `SearchField` y el retardo del `onBlur`, que son los dos sitios
// donde este patrón ya se rompió una vez.
// ═══════════════════════════════════════════════════════════════════════

const RESULTADOS = 8;

export function ReportesEntitySearch({
  items,
  clave,
  placeholder,
  seleccionado,
  etiquetaQuitar,
}: {
  items: { id: string; nombre: string }[];
  /** El parámetro de la URL: `producto` o `proveedor`. */
  clave: string;
  placeholder: string;
  /** El nombre de lo elegido, o `null`. Ver el de clientes: con algo elegido
   *  el campo deja de ser un buscador y pasa a ser una etiqueta con salida. */
  seleccionado: string | null;
  etiquetaQuitar: string;
}) {
  const { set } = useParamPush();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const q = foldForSearch(query.trim());
  const results = q === "" ? [] : items.filter((i) => foldForSearch(i.nombre).includes(q)).slice(0, RESULTADOS);

  if (seleccionado) {
    return (
      <div className="flex h-[50px] w-full items-center justify-between gap-2 rounded-[10px] border-2 border-brand-field-border bg-brand-field pr-3 pl-4">
        <span className="truncate text-[17px] text-brand-secondary">{seleccionado}</span>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            set(clave, null, "push");
          }}
          aria-label={etiquetaQuitar}
          className="shrink-0 rounded text-brand-secondary outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <SearchField
        tone="dark"
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        // EL MISMO RETARDO que el de clientes, y por la misma razón: tocar un
        // resultado desenfoca el campo, y desmontar la lista en ese instante
        // hace que el toque aterrice en lo que ocupe su sitio.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && q !== "" ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Sin resultados para &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <ul>
              {results.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      set(clave, i.id, "push");
                    }}
                    className="w-full truncate px-3 py-3 text-left text-sm transition-colors hover:bg-accent"
                  >
                    {i.nombre}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
