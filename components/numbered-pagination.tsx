"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { visiblePages } from "@/lib/products/pagination";

// «‹ Anterior · 1 [2] 3 · Siguiente ›», under a product grid. The owner chose numbered
// pages on 2026-11-15 from three options; one component for the sale's product step and
// the customer's catalogue, so the two faces page the same way.
//
// NOTHING IS DRAWN WITH ONE PAGE: a row of controls that lead nowhere only takes room.
//
// NO FIGMA FRAME YET: built from the sketch the owner picked in the question. It needs its
// frame and its PDF before launch (CLAUDE.md, interfaces in Figma, Drive and Trello).
export function NumberedPagination({
  page,
  pages,
  onChange,
  className,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (pages <= 1) return null;

  const arrow =
    "flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav aria-label="Páginas de productos" className={cn("flex items-center justify-between gap-1", className)}>
      <button type="button" className={arrow} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Anterior
      </button>

      <div className="flex min-w-0 items-center gap-1">
        {visiblePages(page, pages).map((slot, i) =>
          slot === "gap" ? (
            <span key={`gap-${i}`} aria-hidden="true" className="w-3 text-center text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              aria-label={`Página ${slot}`}
              aria-current={slot === page ? "page" : undefined}
              onClick={() => onChange(slot)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-sm tabular-nums",
                slot === page ? "bg-foreground font-medium text-background" : "text-foreground",
              )}
            >
              {slot}
            </button>
          ),
        )}
      </div>

      <button type="button" className={arrow} disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Siguiente
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </nav>
  );
}
