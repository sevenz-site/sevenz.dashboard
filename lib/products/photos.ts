// HOW MANY PHOTOS A PRODUCT CAN HAVE, and how a list of them is split for storage.
//
// TWO SINCE 2026-11-15, owner's request: «limitemos la carga de fotos a los productos solo
// a 2». It was five from v0.6.0 (CT-171, owner's request of 2026-11-12: «Poder subir hasta
// 5 fotos del producto en el catálogo», «la primera foto es la portada»).
//
// The cover goes to `products.photo_path`, which every older screen reads; the second
// photo goes to `product_photos` at position 1 (migration 204). The check migration 208
// puts on that table (`position = 1`) is the database half of this same number.
export const MAX_PRODUCT_PHOTOS = 2;

// WHAT A PRODUCT SAVED BEFORE THE CAP DROPPED MAY STILL HOLD. Lowering the cap deletes
// nobody's photos: a product that already had three, four or five keeps them, shows them
// in both galleries and can be edited without losing them. It just cannot get a new one
// until it is under `MAX_PRODUCT_PHOTOS`. Removing them is the owner's decision, and he
// has not taken it.
//
// So READING uses this number and ADDING uses the one above. Cutting a read to two would
// open the editor of a five-photo product with two, and its next save -- even a price
// change -- would drop the other three without a word.
export const LEGACY_MAX_PRODUCT_PHOTOS = 5;

// The photos of a product in display order: cover first, then the extras. Duplicates and
// empty paths are dropped, and the list never exceeds what the table could ever hold -- a
// defensive read of data that the save already keeps clean.
export function photosInOrder(cover: string | null | undefined, extras: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of [cover, ...extras]) {
    const path = (p ?? "").trim();
    if (path && !out.includes(path)) out.push(path);
  }
  return out.slice(0, LEGACY_MAX_PRODUCT_PHOTOS);
}

// MAY THIS LIST OF PHOTOS BE SAVED? The one rule, shared by the server action and by
// `qa:fotos`, so the screen, the server and the suite cannot disagree about it.
//
//   - Up to `MAX_PRODUCT_PHOTOS`: always.
//   - More than that: only when the list is what the product ALREADY had, in the same
//     order, with some photos possibly removed. That is a product from before the cap
//     keeping what it has, or dropping some. One new photo in a list over the cap is
//     refused, and so is a reshuffle: the screen cannot reorder, and the save relies on
//     every kept extra already having its row (see `writeSatellites`).
//
// `saved` is what the product holds in the database right now, cover first and then the
// extras by position; empty for a product being created, which therefore can never go
// over the cap.
// WHICH ROWS OF `product_photos` A SAVE OVER THE CAP DELETES: the ones the shopkeeper
// removed, and only those. The rows he kept are never rewritten, because migration 208
// would refuse to take them back at positions 2 to 4. A pure function so `qa:fotos` can
// check it: once 208 has run, no script can build a product over the cap to try it live.
export function photoRowsToRemove(rows: { path: string; position: number }[], keptExtras: string[]): number[] {
  return rows.filter((r) => !keptExtras.includes(r.path)).map((r) => r.position);
}

export function photosWithinCap(next: string[], saved: (string | null | undefined)[]): boolean {
  if (next.length <= MAX_PRODUCT_PHOTOS) return true;
  if (next.length > LEGACY_MAX_PRODUCT_PHOTOS) return false;
  let matched = 0;
  for (const path of saved) {
    if (path && path === next[matched]) matched += 1;
  }
  return matched === next.length;
}
