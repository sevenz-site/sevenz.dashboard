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
  search,
  filters,
}: {
  title: string;
  // Optional since 2026-10-04: the spec turns this layer off on `/reportes`,
  // where the period chip underneath already says what window the bars cover.
  subtitle?: string;
  // The slot beside the title. Only Clientes fills it, with "Subir libreta";
  // the spec leaves it empty on Malas pagas and Papelera.
  action?: React.ReactNode;
  search: React.ReactNode;
  filters: React.ReactNode;
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
          href="/dashboard"
          aria-label="Volver a Inicio"
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
        {collapsed ? action : null}
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

      <div className="px-4 py-4">{search}</div>
      <div className="px-4 pb-4">{filters}</div>
    </header>
  );
}
