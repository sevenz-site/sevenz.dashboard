"use client";

import type { Categoria } from "@/lib/products/categories";
import { ordenarCategorias } from "@/lib/products/categories";

// THE CATEGORY CHIPS: «Todas», then one per category. Owner's request of
// 2026-11-03, «en el catálogo tanto del dueño como del cliente», so ONE
// component for both faces (CLAUDE.md: a visual value shown in two screens is
// born in a component). Each face decides WHICH categories it passes: the
// owner's catalogue all of his, the client's only those with a published
// product (migration 184's `get_shared_catalog`).
//
// ONE ROW THAT SCROLLS SIDEWAYS, never wraps: a shop with twelve categories
// would otherwise push the products half a screen down. The row scrolls
// inside itself, so the page never gains horizontal scroll at 375px.
//
// TWO TONES because the owner's chips sit on the dark header next to «Ordenar
// por» / «Estado» / «Monto» and reuse their border (`--brand-field-border`,
// 5,78:1, DESIGN-SYSTEM.md); the client's sit on white.

export function CategoryChips({
  categorias,
  value,
  onChange,
  tone = "light",
}: {
  categorias: Categoria[];
  value: string | null;
  onChange: (id: string | null) => void;
  tone?: "light" | "dark";
}) {
  // No categories, no row: «Todas» alone filters nothing and only takes room.
  if (categorias.length === 0) return null;

  const base =
    "h-8 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  const clase = (activo: boolean) =>
    tone === "dark"
      ? `${base} ${activo ? "border-white bg-white font-medium text-brand-primary" : "border-brand-field-border text-brand-muted hover:bg-white/10 hover:text-white"}`
      : `${base} ${activo ? "border-foreground bg-foreground font-medium text-background" : "border-border text-foreground hover:bg-muted"}`;

  const opciones: { id: string | null; name: string }[] = [
    { id: null, name: "Todas" },
    ...ordenarCategorias(categorias),
  ];

  return (
    <div role="group" aria-label="Filtrar por categoría" className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1">
      {opciones.map((c) => (
        <button
          key={c.id ?? "todas"}
          type="button"
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={clase(value === c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
