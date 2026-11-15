// ═══════════════════════════════════════════════════════════════════════
// ¿ESTA RUTA ES LA FICHA DE UN PRODUCTO?
//
// `/productos/<uuid>` — la ficha del lado del dueño, frame `1730:14329`,
// encargo del 2026-10-27.
//
// VIVE AQUÍ PORQUE LA PREGUNTAN CUATRO ARCHIVOS, y los cuatro tienen que
// contestar lo mismo o la pantalla sale mal de una forma que no se parece a su
// causa:
//
//   · `app-header.tsx`      — si no, salen DOS cabeceras y la marca se repite.
//   · `mobile-nav.tsx`      — si no, la barra de abajo se dibuja ENCIMA de
//                             «Eliminar» y el botón no se puede pulsar.
//   · `app-main.tsx` (×2)   — el aire de abajo y los 40px de la fila de
//                             botones.
//
// Las tres primeras son las listas que `CLAUDE.md` nombra: «una pantalla con
// barra pegada abajo hay que apuntarla en tres sitios». Repetir el patrón en
// cada archivo es cómo se desincronizan: la cuarta vez que se añadió una
// cabecera que no tocaba, fue porque cada lista se mantiene a mano.
//
// LA FORMA DEL UUID Y NO `[^/]+`, y es la trampa que el comentario de
// `app-header.tsx` ya avisaba: `/^\/productos\/[^/]+$/` casaría también con
// `/productos/ordenes` --que es una LISTA y sí lleva cabecera en pantalla
// ancha-- y con `/productos/nuevo`. Un id es siempre un uuid; esos dos no.
const FICHA_DE_PRODUCTO =
  /^\/productos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProductDetailRoute(pathname: string): boolean {
  return FICHA_DE_PRODUCTO.test(pathname);
}

// THE «PERSONALIZAR CATÁLOGO» SCREEN (CT-170, frames `2115:21868` and `2115:21966`),
// since 2026-11-15. A full screen with its own back row and its buttons pinned at the
// bottom, so it goes in the same three lists as the product form: no bottom bar on top
// of «Guardar cambios», and no extra air under it. The app header is already hidden for
// it by `startsWith("/productos")` in `app-header.tsx`.
export const CATALOG_BRANDING_ROUTE = "/productos/personalizar";

export function isCatalogBrandingRoute(pathname: string): boolean {
  return pathname === CATALOG_BRANDING_ROUTE;
}
