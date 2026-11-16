"use client";

import type { Categoria } from "@/lib/products/categories";
import { ordenarCategorias } from "@/lib/products/categories";

// THE CATEGORY CHIPS: «Todas (N)», then «Nombre (N)» per category. Drawn in
// frame `1958:16272` (component `chip-catalog-categories`, owner's request of
// 2026-11-03), and ONE component for both faces (CLAUDE.md: a visual value
// shown in two screens is born in a component).
//
// THE COUNT IS EACH FACE'S, and they differ on purpose — owner's decision of
// 2026-11-03: *«Al dueño: todos los productos de esa categoría publicados o
// no. Al cliente: solo los publicados»*. The component only prints the number
// it is given; each caller counts what its own screen lists.
//
// THE COUNT DOES NOT FOLLOW THE OTHER FILTERS (search, «Estado», «Monto»):
// it says how big the category is, not how many cards are on screen right
// now. A count that shrinks while typing in the search box would read as
// products disappearing.
//
// ONE ROW THAT SCROLLS SIDEWAYS, never wraps: a shop with twelve categories
// would otherwise push the products half a screen down. The row scrolls
// inside itself, so the page never gains horizontal scroll at 375px.
//
// UNTIL 2026-11-03 THERE WAS A DARK TONE for the owner's chips, which sat in
// the dark header under «Ordenar por». The frame moved them below the
// «Pedidos» card, onto white, so both faces now draw the same chip.

export type CategoriaConProductos = Categoria & { productos: number };

export function CategoryChips({
  categorias,
  total,
  value,
  onChange,
}: {
  categorias: CategoriaConProductos[];
  // What «Todas» counts: every product the screen lists.
  total: number;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  // No categories, no row: «Todas» alone filters nothing and only takes room.
  if (categorias.length === 0) return null;

  const opciones: { id: string | null; name: string; productos: number }[] = [
    { id: null, name: "Todas", productos: total },
    ...(ordenarCategorias(categorias) as CategoriaConProductos[]),
  ];

  return (
    <div role="group" aria-label="Filtrar por categoría" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 py-1">
      {opciones.map((c) => {
        const activo = value === c.id;
        return (
          <button
            key={c.id ?? "todas"}
            type="button"
            aria-pressed={activo}
            onClick={() => onChange(c.id)}
            // 34px tall, 8px padding, 12/16 text, as drawn. `border-primary`
            // on the chosen one so its edge does not show a lighter ring
            // around the dark fill.
            className={`h-[34px] shrink-0 rounded-full border px-2 text-xs leading-4 whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
              activo ? "border-primary bg-primary text-primary-foreground" : "border-border text-primary hover:bg-muted"
            }`}
          >
            {c.name} ({c.productos})
          </button>
        );
      })}
    </div>
  );
}
