// HOW MANY PHOTOS A PRODUCT CAN HAVE, and how a list of them is split for storage.
// CT-171, owner's request of 2026-11-12: «Poder subir hasta 5 fotos del producto en el
// catálogo», «la primera foto es la portada».
//
// The cover goes to `products.photo_path`, which every older screen reads; photos 2 to 5
// go to `product_photos` at positions 1 to 4 (migration 204). The check on that table
// (`position between 1 and 4`) is the database half of this same number.
export const MAX_PRODUCT_PHOTOS = 5;

// The photos of a product in display order: cover first, then the extras. Duplicates and
// empty paths are dropped, and the list never exceeds the maximum -- a defensive read of
// data that the save already keeps clean.
export function photosInOrder(cover: string | null | undefined, extras: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of [cover, ...extras]) {
    const path = (p ?? "").trim();
    if (path && !out.includes(path)) out.push(path);
  }
  return out.slice(0, MAX_PRODUCT_PHOTOS);
}
