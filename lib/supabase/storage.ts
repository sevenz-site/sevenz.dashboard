export function getPublicLogoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/logos/${path}`;
}

export function getPublicClientProfilePictureUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/client-profile-pictures/${path}`;
}

// A product's photo. Bucket `product-photos`, created by migration 084 and
// public for the same reason `logos` is: the catalogue page is opened by
// somebody with no session and has to be able to render it.
export function getPublicProductPhotoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/product-photos/${path}`;
}

// A PRODUCT PHOTO FOR A GRID OR A LIST, 400px wide, for performance on weak signals:
// owner's go-ahead of 2026-11-15 («Implementa todas las soluciones propuestas de
// rendimiento»). The original is up to 1600px and 267-374 KB (see below); the grids
// draw it at 48-320 CSS px, so a page of ten cards was 3-4 MB of photo.
//
// A STORED FILE, NOT A TRANSFORMATION, since the same day. v0.7.0 shipped this as a URL of
// Supabase's `/render/image/`, which bills every distinct photo served that way, once per
// billing cycle: 100 are included, and the counter went from 37 to 121 within hours of the
// release, because every cover in every grid became one. Owner's decision of 2026-11-15:
// «Aprobado B con las soluciones para peores escenarios» -- B being "save the thumbnail
// when the photo is uploaded and serve it as it is".
//
// So the thumbnail is its own object, next to the photo and named after it:
//
//     <owner>/<uuid>.jpg            the photo, up to 1600px
//     <owner>/<uuid>.jpg.thumb.jpg  its thumbnail, 400px wide
//
// THE SUFFIX IS APPENDED TO THE WHOLE NAME, extension included, so the photo is always
// the thumbnail's name minus the suffix, whatever the photo is called. Three places rely
// on that and must change together: this file, `lib/products/upload-photo.ts` (which
// writes it from the browser), and migration 209 (the nightly cleanup, which must know a
// thumbnail belongs to its photo or it deletes it a week after upload; and the nightly
// pass that makes the ones that are missing).
//
// WIDTH ONLY, no height and no crop: the proportion is kept, and each screen already crops
// with `object-cover`, so a tall photo and a wide one both fill their tile exactly as before.
//
// A PHOTO MAY HAVE NO THUMBNAIL: every photo uploaded before this, and any whose thumbnail
// failed to upload on a weak phone. NEVER PUT THIS URL IN AN `<img>` DIRECTLY. Draw it
// with `ProductThumbnail` (`components/product-thumbnail.tsx`), which falls back to the
// photo itself when the thumbnail is not there; a bare `<img>` would show a broken image.
export const PRODUCT_THUMBNAIL_SUFFIX = ".thumb.jpg";
export const PRODUCT_THUMBNAIL_WIDTH = 400;
// 0-100. The browser's canvas takes it as 0.7 and the server's `sharp` as 70.
export const PRODUCT_THUMBNAIL_QUALITY = 70;

export function productThumbnailPath(path: string): string {
  return `${path}${PRODUCT_THUMBNAIL_SUFFIX}`;
}

export function getProductThumbnailUrl(path: string): string {
  return getPublicProductPhotoUrl(productThumbnailPath(path));
}

// ═══════════════════════════════════════════════════════════════════════
// LA FOTO DEL PRODUCTO PARA LA VISTA PREVIA DE UN ENLACE
//
// 1200x630 recortada, JPEG, ~114 KB. Es la tarjeta que dibuja el frame
// `1732:14757` y la que WhatsApp pinta al compartir un producto.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUE NO SE GENERA LA IMAGEN, QUE ES LO QUE HABIA Y FALLO
//
// Hasta el 2026-10-27 esta vista previa la componia un `opengraph-image.tsx`
// con `ImageResponse`. Las etiquetas eran correctas, la ruta devolvia 200 y la
// imagen era la foto del producto -- y aun asi WhatsApp no la ensenaba.
//
// LA CAUSA ERA EL PESO. `ImageResponse` SOLO emite PNG, y una foto a 1200x630
// en PNG pesa 1,4-1,6 MB (medido en los tres productos del dueno). WhatsApp
// descarta las vistas previas pesadas: «Cartas UNO» salio sin imagen ninguna y
// «Bafle azul jbl» cayo al logo de la marca. `/og.png` siempre funciono porque
// es un grafico plano de unos pocos KB -- la pista que lo explicaba todo.
//
// Asi que no se genera nada: se sirve la foto que ya existe, recortada por
// Supabase. 114 KB contra 1.600, y sin arranque en frio de por medio.
//
// ───────────────────────────────────────────────────────────────────────
// DE QUE DEPENDE ESTO, DICHO EN VOZ ALTA
//
// `/render/image/` son las transformaciones de imagen de Supabase, que son una
// funcion de pago (Pro en adelante). Esta activa en este proyecto -- probada
// contra la rama dev el 2026-10-27, 200 con `image/jpeg`. Si algun dia se
// desactivara, la URL fallaria y las vistas previas volverian al logo, EN
// SILENCIO.
//
// LA SALIDA SIN DEPENDENCIA, por si hace falta: `getPublicProductPhotoUrl`,
// la foto original. Pesa 267-374 KB porque `lib/image.ts` ya la sube acotada a
// 1600px y calidad 0,85, asi que tambien entra de sobra -- lo que se pierde es
// el recorte exacto a la proporcion de la tarjeta.
export function getProductPreviewImageUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return (
    `${base}/storage/v1/render/image/public/product-photos/${path}` +
    "?width=1200&height=630&resize=cover&quality=75"
  );
}
