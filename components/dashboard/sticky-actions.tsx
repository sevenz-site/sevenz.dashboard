// LOS BOTONES DEL FLUJO DE REGISTRAR, SIEMPRE A LA VISTA.
//
// Petición del dueño el 2026-10-18: «todos los botones del flujo Registrar
// deben mantenerse visibles en la parte inferior de la pantalla, similar al
// componente navbar o el botón ver carrito».
//
// ===========================================================================
// LO QUE SE GANA, Y NO ES COMODIDAD
//
// Esos botones estaban al FINAL de la columna. En el carrito con ocho líneas,
// o en el paso 4 con el formulario de alta entero debajo, «Ir a pago» y
// «Finalizar» solo aparecían tras recorrer la pantalla hasta abajo. El tendero
// que ya decidió cobrar tiene que buscar el botón que cierra la venta, con el
// cliente delante. Es el mismo arreglo que la píldora del carrito recibió en
// el paso 1, extendido al resto del flujo.
//
// ===========================================================================
// `sticky` Y NO `fixed`, Y ESA ES LA DECISIÓN QUE IMPORTA
//
// Un `fixed` flota fuera del flujo, así que hay que reservarle sitio a mano en
// `AppMain` —tantos píxeles como mida la barra— y esa cuenta se descuadra el
// día que una pantalla ponga DOS botones en vez de uno. `/clients/nuevo` pone
// dos; el carrito, uno.
//
// `sticky` ocupa su sitio en la columna: el contenido nunca queda debajo
// porque el navegador ya lo tuvo en cuenta, y la altura la decide el contenido
// real. Con `mt-auto` se va al fondo cuando la pantalla sobra, y se pega al
// borde inferior mientras haya scroll.
//
// ===========================================================================
// EL AIRE DE ABAJO VIVE AQUÍ, NO EN `AppMain`
//
// Los 40px que el dueño pidió el mismo día —«para que los botones no queden
// tan pegados a la parte inferior del teléfono ni el widget»— los pone esta
// barra. `AppMain` deja de añadirlos en las dos pantallas que la montan: si
// los pusieran los dos, serían 80 y la barra se quedaría flotando a media
// altura al final del scroll.
export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    // `-mx-4 px-4` cancela el padding de `AppMain` y lo devuelve, para que la
    // línea de arriba llegue a los bordes como la de la barra de abajo. Dentro
    // de un `max-w-md` el ancho queda acotado por la columna, que es lo que se
    // quiere en un escritorio.
    <div className="sticky bottom-0 -mx-4 mt-auto border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
