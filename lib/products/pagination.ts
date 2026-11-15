// PRODUCT PAGES OF TEN, for the sale's product step and the customer's catalogue.
// Owner's request of 2026-11-15: «paginado de 10 productos (…) eso ayudará a que no se
// tengan que cargar todos los productos en la vista», with numbered pages (his choice
// between «Ver más», numbered pages and infinite scroll) and the same on both faces.
//
// One module for both faces, so the shopkeeper's counter and the customer's catalogue
// cannot split a list differently (CLAUDE.md: a value shown in two screens is born once).

export const PRODUCTS_PER_PAGE = 10;

export function pageCount(total: number, perPage = PRODUCTS_PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** A page number brought back inside 1..pages (a filter can shrink the list under it). */
export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, pages));
}

export type PageSlot = number | "gap";

// AT MOST FIVE SLOTS, TWO OF THEM NARROW GAPS: the first page, the current one, the last
// one, and its neighbour when it touches an edge. Measured for a 375px phone, where the
// row also carries «Anterior» and «Siguiente»; a full run of numbers past five pages
// pushes the row wider than the screen.
//   7 pages, on 1 → 1 2 … 7     on 4 → 1 … 4 … 7     on 7 → 1 … 6 7
export function visiblePages(current: number, pages: number): PageSlot[] {
  if (pages <= 3) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set<number>([1, pages, current]);
  if (current === 1) keep.add(2);
  if (current === pages) keep.add(pages - 1);
  const sorted = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const slots: PageSlot[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) slots.push("gap");
    slots.push(sorted[i]);
  }
  return slots;
}
