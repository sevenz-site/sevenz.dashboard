"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSearchResultsOpen } from "@/components/dashboard/client-filter-context";
import { useCollapseOnScroll } from "@/hooks/use-collapse-on-scroll";

// THE DARK HEADER OF CLIENTES, MALAS PAGAS AND PAPELERA
//
// From the Figma spec of 2026-10-04 (frame `1074:18856`), where it is one
// shared component used by all three screens — so it is one component here too.
// It replaces the `sm:hidden` back row those screens carried, and swallows the
// title, the subtitle, the search field and the filter chips with it.
//
// ─────────────────────────────────────────────────────────────────────────
// IT IS NOT `HomeHeader`, AND THAT IS ON PURPOSE
//
// Inicio's header carries a logo, a notifications link, a greeting and a
// business name, and no back arrow — it is the screen you go back TO. The two
// share a surface, not a structure. What they do share is the rule for
// collapsing, and that lives in `useCollapseOnScroll` so there is one copy of
// it rather than two that drift.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT COLLAPSES, AND WHY THOSE TWO
//
// Owner's call on 2026-10-04: the title and the subtitle go, the back arrow,
// the search field and the filters stay. The block is 234px on Clientes and
// 279px on the other two — more than a third of a 667px phone — and on a list
// screen the controls are what you reach for again and again, while the title
// tells you something you already know by the time you have scrolled.
export function ScreenHeader({
  title,
  subtitle,
  action,
  topAction,
  search,
  filters,
  backHref = "/dashboard",
  backLabel = "Volver a Inicio",
}: {
  title: string;
  // Optional since 2026-10-04: the spec turns this layer off on `/reportes`,
  // where the period chip underneath already says what window the bars cover.
  subtitle?: string;
  // The slot beside the title. Only Clientes fills it, with "Subir libreta";
  // the spec leaves it empty on Malas pagas and Papelera.
  action?: React.ReactNode;
  // THE SLOT ON THE BACK-ARROW ROW, which `action` is not: `action` lives
  // beside the title and only climbs up here when the header collapses, so a
  // control put there moves as the owner scrolls. This one stays put.
  //
  // Added 2026-10-15 for the catalogue's overflow menu, at the owner's
  // request: the "⋮" belongs on the top row, level with the back arrow, while
  // "Compartir" stays beside the title. Two controls, two heights, on purpose
  // — sharing is the daily action and sits where the eye lands; the menu is
  // the occasional one and sits out of the way.
  //
  // When the header collapses, both end up on this row. That is the intended
  // outcome and not a collision: "← … Compartir ⋮" is exactly what a
  // scrolled-down catalogue should offer.
  topAction?: React.ReactNode;
  search: React.ReactNode;
  filters: React.ReactNode;
  // ── ADÓNDE VUELVE LA FLECHA ──────────────────────────────────────────
  //
  // Inicio por defecto, que es de donde se llega a Clientes, Malas pagas,
  // Papelera, Catálogo y Reportes. **Pedidos no**: se entra desde Catálogo, y
  // hasta el 2026-10-20 la flecha lo sacaba al Inicio de todas formas —el
  // dueño lo reportó ese día con la flecha rodeada en rojo.
  //
  // UN DESTINO EXPLÍCITO Y NO `router.back()`. La historia del navegador no
  // es la jerarquía de la app: a Pedidos también se llega desde una
  // notificación o recargando la página, y ahí «atrás» es cualquier cosa o
  // nada. Lo que la flecha promete es subir un nivel, y eso lo sabe la
  // pantalla, no el historial.
  backHref?: string;
  // Se pasa junto al destino a propósito: son el mismo dato dicho dos veces
  // —uno para el dedo y otro para quien no ve la pantalla— y separarlos es
  // cómo acaban contradiciéndose.
  backLabel?: string;
}) {
  // Frozen while the owner types, same as Inicio. The context is the page's
  // `ClientFilterProvider`; the default value is `focused: false`, so a screen
  // that has not mounted one simply never freezes.
  const { focused } = useSearchResultsOpen();
  const { collapsed, collapsibleRef } = useCollapseOnScroll(focused);

  return (
    // One sticky element, not four. A `sticky` child only sticks inside its
    // containing block, so making the rows sticky one by one would unpin them
    // the moment the dark div scrolled past — see `home-header.tsx`, which
    // learned it the hard way.
    <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col bg-brand-primary">
      {/* No padding and no gap on the header itself: each row carries its own,
          and they differ. 16 all round for the back arrow, 8 over nothing for
          the title and the subtitle, 16 for the field, and 0/16/16/16 for the
          chips. */}
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="-m-2 rounded-md p-2 text-brand-muted outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowLeft className="size-6" aria-hidden="true" />
        </Link>
        {/* THE ACTION MOVES UP HERE WHEN THE HEADER COLLAPSES, so it does not
            leave with the title it was sitting next to. Only Clientes has one;
            on the other two `action` is undefined and this row keeps the arrow
            alone on the left.

            It is rendered in one place or the other, never both: two instances
            of `ImportarCartera` would mean two `data-tour="import-button"`
            markers, and the tour finds its target with `querySelector`, which
            takes whichever comes first in the DOM — possibly the hidden one. */}
        <div className="flex items-center gap-1">
          {collapsed ? action : null}
          {topAction}
        </div>
      </div>

      {/* One wrapper around everything that disappears, because the hook
          measures it: the threshold that keeps the collapse from oscillating is
          derived from this element's height. See `useCollapseOnScroll`. */}
      {collapsed ? null : (
        <div ref={collapsibleRef}>
          <div className="flex items-center justify-between gap-3.5 px-4 pt-2">
            <h1 className="truncate text-2xl font-medium text-white">{title}</h1>
            {action}
          </div>
          {subtitle ? (
            <div className="px-4 pt-2">
              <p className="text-sm text-brand-muted">{subtitle}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* A SLOT THAT IS NULL TAKES NO ROOM. Until 2026-10-16 both wrappers
          rendered whatever happened, so a screen with neither — Pedidos is
          the first — ended with 48px of empty black bar under its subtitle
          (16+16 from the search row, 16 from the chips). Nothing was wrong
          with it except that it looked like something had failed to load.

          The screens that pass real nodes render exactly as before: this
          only decides whether the wrapper exists at all. */}
      {search ? <div className="px-4 py-4">{search}</div> : null}
      {/* ── 16px BAJO EL SUBTÍTULO, HAYA BUSCADOR O NO ──────────────────
          Este envoltorio llevaba `pb-4` y NADA arriba, porque daba por hecho
          que encima iba el buscador con sus `py-4`. En una pantalla sin
          buscador los filtros quedaban pegados al subtítulo.

          SE VE DENTRO DE UNA MISMA PANTALLA, que es lo que lo delató: en
          `/reportes` el buscador solo sale en «Facturación», así que esa
          pestaña tenía su hueco y las otras dos no. El dueño lo reportó el
          2026-10-29 con la captura de «Inventario».

          `pt-4` SOLO CUANDO NO HAY BUSCADOR, y no siempre: con él arriba el
          hueco ya está puesto y sumar otros 16 daría 32. */}
      {filters ? (
        <div className={search ? "px-4 pb-4" : "px-4 pt-4 pb-4"}>{filters}</div>
      ) : null}
      {/* And when neither is there, the bottom padding has to come from
          somewhere: without this the subtitle sits flush against the edge of
          the dark block. */}
      {!search && !filters ? <div className="pb-4" /> : null}
    </header>
  );
}
