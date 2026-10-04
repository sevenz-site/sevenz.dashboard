"use client";

import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import {
  ClientResultList,
  CLIENT_RESULT_LIMIT,
} from "@/components/dashboard/client-result-list";
import {
  useSearchResultsOpen,
  useSharedClientFilters,
} from "@/components/dashboard/client-filter-context";
import { track } from "@/lib/mixpanel";
import { clientHref } from "@/lib/client-origin";

// El buscador de Cartera: campo arriba del todo y las coincidencias justo
// debajo, con la misma lista que el diálogo de "Agregar movimiento".
//
// POR QUÉ AQUÍ SÍ HAY LISTA Y EN LAS OTRAS TRES NO. En Clientes, Malas pagas y
// Papelera las tarjetas están a dos centímetros del campo: enseñar una lista
// encima sería enseñar lo mismo dos veces. En Cartera la lista de clientes
// está al final de la pantalla, detrás del capital y la tira de tasas —
// escribir y no ver nada cambiar se lee como que el buscador no funciona.
//
// La regla, entonces, no es "con desplegable" o "sin él": es si el resultado
// se ve desde donde estás escribiendo.
//
// ─────────────────────────────────────────────────────────────────────────
// ADEMÁS FILTRA LA LISTA DE ABAJO, que es lo que lo diferencia del diálogo.
//
// El diálogo solo encuentra y abre. Aquí el texto va al estado compartido, así
// que la cartera del final queda recortada al mismo criterio. Una sola verdad:
// lo que sale en la lista de arriba y lo que queda abajo no pueden discrepar
// porque salen del mismo sitio — `sortedRows`, ya pasado por los chips.
//
// El efecto secundario que conviene conocer: al terminar de buscar hay que
// vaciar el campo para recuperar la cartera entera. Por eso el aspa está
// siempre a mano en cuanto hay texto.
//
// ─────────────────────────────────────────────────────────────────────────
// IT LIVES INSIDE THE DARK HEADER, AND THAT IS WHERE ITS WHOLE LOOK COMES FROM
//
// Since 2026-10-03 this field does not sit on the page background: it sits on
// `--brand-primary` (#272727), which is the same value in both themes. That is
// why not one of its colours is a semantic token — in the dark theme `--input`
// and `--ring` invert and would leave it invisible on a background that does
// not. That is the two-layer rule in `DESIGN-SYSTEM.md`.
//
// TWO THINGS THAT CANNOT BE TOUCHED, both measured with `npm run qa:contraste`:
//
//   1. THE 2px BORDER IS NOT DECORATION. The field's fill sits at 1,91:1
//      against the header, below the 3:1 WCAG 1.4.11 asks for. What makes the
//      search field visible is the border, not its background. Removing it
//      leaves an invisible field, and the failure reads as "the search box is
//      missing".
//
//   2. THE PLACEHOLDER CANNOT BE DIMMED. That is what every other input in this
//      repo does by default (`placeholder:text-muted-foreground`), and here it
//      fails at ANY opacity: 2,64:1 at 50%, and still 4,23:1 at 80%, below the
//      4,5:1 for text. Full opacity or nothing.
//
// That the placeholder and the typed value are the same #DADADA is deliberate
// and has a known cost: at a glance, colour does not tell an empty field from a
// filled one. What tells them apart is the icon — magnifier when empty, cross
// when there is text. The alternative was a white placeholder (7,80:1), which
// would leave it BRIGHTER than the value: the opposite of what it means.

export function ClientSearchCartera({ placeholder = "Buscar cliente" }: { placeholder?: string }) {
  const router = useRouter();
  const filters = useSharedClientFilters();
  // El estado vive en el proveedor, no aquí: "Agregar movimiento" se aparta
  // con el mismo valor, y dos cálculos separados acabarían discrepando.
  const { open: abierta, setFocused } = useSearchResultsOpen();
  if (!filters) return null;

  const c = filters.controls;
  const query = c.nameQuery.trim();

  const results = filters.sortedRows.slice(0, CLIENT_RESULT_LIMIT).map((row) => ({
    id: row.client_id,
    name: row.name,
    documentId: row.document_id,
  }));

  return (
    <div className="relative">
      <div className="relative">
        {/* 40px and `text-base` on a phone, like the other three search fields.
            The second is not cosmetic: iOS Safari zooms in on focus for any
            field under 16px.

            The design's two shadows: one inset and one drop, both 0/4/4. The
            inset one darkens the fill's top edge, which RAISES the contrast of
            the light text on top of it — it does not lower it. What it worsens
            is the fill's separation from the header, and that is the border's
            job, not the background's. */}
        <input
          type="text"
          value={c.nameQuery}
          onChange={(e) => c.setNameQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          onFocus={() => setFocused(true)}
          // El proveedor retrasa el apagado: deja que el clic sobre un
          // resultado se resuelva antes de desmontar la lista. Los resultados
          // además evitan robar el foco en mousedown, pero un toque en el
          // borde de la lista sí lo quita.
          onBlur={() => setFocused(false)}
          className="h-10 w-full min-w-0 rounded-lg border-2 border-brand-field-border bg-brand-field px-3 pr-9 text-base text-brand-secondary shadow-[inset_0_4px_4px_rgba(0,0,0,0.25),0_4px_4px_rgba(0,0,0,0.25)] outline-none transition-colors placeholder:text-brand-secondary focus-visible:border-white focus-visible:ring-3 focus-visible:ring-white/40 md:text-sm"
        />
        {c.nameQuery ? (
          <button
            type="button"
            onClick={() => c.setNameQuery("")}
            aria-label="Borrar búsqueda"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded text-brand-secondary outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <X className="size-4" />
          </button>
        ) : (
          <Search
            aria-hidden="true"
            className="absolute top-1/2 right-3 -translate-y-1/2 size-4 text-brand-secondary"
          />
        )}
      </div>

      {abierta ? (
        // Flotando sobre la pantalla, no empujándola: la cartera de abajo ya
        // se está recortando con cada letra, y si además el contenido bajara
        // 200px por cada resultado, el dueño vería la pantalla saltar mientras
        // escribe.
        <div className="absolute top-full right-0 left-0 z-50 mt-1 bg-popover shadow-md">
          <ClientResultList
            results={results}
            onSelect={(id) => {
              track("Client Details Opened", { client_id: id, source: "cartera" });
              router.push(clientHref(id, "cartera"));
            }}
          />
          {results.length === 0 ? (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              Sin resultados para &quot;{query}&quot;.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
