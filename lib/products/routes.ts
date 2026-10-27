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
