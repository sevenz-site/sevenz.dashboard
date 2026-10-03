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
// VA DENTRO DE LA CABECERA OSCURA, Y DE AHÍ SALE TODO SU ASPECTO
//
// Desde el 2026-10-03 este campo no vive sobre el fondo de la página: vive
// sobre `--brand-primary` (#272727), que vale lo mismo en los dos temas. Por
// eso ni un solo color suyo es un token semántico — en tema oscuro `--input` y
// `--ring` se invierten y lo dejarían invisible sobre un fondo que no se
// invierte. Esa es la regla de las dos capas de `DESIGN-SYSTEM.md`.
//
// DOS COSAS QUE NO SE PUEDEN TOCAR, las dos medidas con `npm run qa:contraste`:
//
//   1. EL BORDE DE 2px NO ES DECORACIÓN. El relleno del campo queda a 1,92:1
//      contra la cabecera, por debajo del 3:1 que pide WCAG 1.4.11. Lo que hace
//      que el buscador se vea es el borde, no su fondo. Quitarlo deja un campo
//      invisible, y el fallo se lee como "el buscador no está".
//
//   2. EL PLACEHOLDER NO SE PUEDE ATENUAR. Es lo que hace por defecto cualquier
//      input de este repo (`placeholder:text-muted-foreground`), y aquí falla a
//      CUALQUIER opacidad: 2,64:1 al 50%, y todavía 4,23:1 al 80%, por debajo
//      del 4,5:1 de texto. Va a opacidad completa o no va.
//
// Que el placeholder y el texto escrito sean el mismo #DADADA es deliberado y
// tiene un coste conocido: de un vistazo no se distingue un campo vacío de uno
// escrito por el color. Lo que los distingue es el icono — lupa cuando está
// vacío, aspa cuando hay texto. La alternativa era el placeholder en blanco
// (7,80:1), que lo dejaría MÁS brillante que el valor: al revés de lo que
// significa.

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
        {/* 40px y `text-base` en teléfono, como los otros tres buscadores. Lo
            segundo no es cosmético: iOS Safari hace zoom al enfocar cualquier
            campo por debajo de 16px.

            Las dos sombras del diseño: una interior y una exterior, las dos
            0/4/4. La interior oscurece el borde superior del relleno, que SUBE
            el contraste del texto claro que lleva encima — no lo baja. Lo que
            empeora es la separación del relleno contra la cabecera, y de esa no
            se encarga el fondo sino el borde. */}
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
