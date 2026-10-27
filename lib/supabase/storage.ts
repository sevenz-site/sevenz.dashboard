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
