// La ranura de la cabecera de /import, y por qué existe.
//
// La cabecera del teléfono la pinta `app/(app)/import/page.tsx`, que es un
// Server Component y está POR ENCIMA de `ImportFlow` en el árbol. El botón de
// confirmar, en cambio, necesita todo el estado de la revisión: cuántas filas
// quedan, si falta la cédula, si falta la moneda, si ya se está guardando. Ese
// estado vive dentro de `ImportFlow` y no puede subir sin reescribir la
// pantalla entera.
//
// Así que el botón se queda donde está su estado y viaja con `createPortal` a
// un div vacío que la cabecera deja reservado. Es la misma solución que un
// contexto, del revés: en vez de bajar datos, sube marcado.
//
// LA ALTERNATIVA QUE SE DESCARTÓ era un contexto con el estado de la revisión
// levantado al page. Obliga a que un hijo escriba estado del padre durante el
// render — el patrón que `react-hooks/set-state-in-effect` rechaza y que ya
// costó una vuelta en este repo — o a mover 568 líneas de `ImportFlow` justo
// después de un despliegue a producción. El portal no toca ninguna de las dos.

export const RANURA_ACCION_CABECERA = "import-accion-cabecera";
