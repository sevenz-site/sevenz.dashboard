import { cn } from "@/lib/utils";

// EL ESTADO VACÍO DE TODA LA APP — frame `1499:9618`.
//
// Encargo del dueño el 2026-10-20: *«ese estilo de empty state debe ser el
// estilo para todos los empty states (border, title y subtitle -botones en el
// caso que aplique), así que ajusta todos los empty states como componente a
// ese»*.
//
// ===========================================================================
// HABÍA CUATRO FORMAS DISTINTAS, Y NINGUNA ERA LA DECISIÓN DE NADIE
//
// Al contarlos salieron dieciséis estados vacíos escritos a mano, y entre
// ellos: bordes punteados y bordes sólidos, `rounded-lg` y `rounded-xl`,
// títulos en `text-sm`, en `text-base` y en `font-medium`, rellenos de
// `py-8`, `py-10`, `py-12` y `py-16`. Cada uno defendible por separado;
// juntos, cuatro maneras de decir lo mismo.
//
// Es la misma deriva que ya se arregló con el título de pantalla y la flecha
// de volver el mismo día, y por la misma vía: no había dónde mirar. Un
// estado vacío se escribe cuando se escribe la lista, mirando la lista de al
// lado, que a su vez copió a otra.
//
// ===========================================================================
// EL BORDE ES SÓLIDO, Y ESO CAMBIA LA MITAD DE LOS QUE HABÍA
//
// El frame dibuja `1px` sólido, no punteado. El punteado se lee como «aquí
// falta algo por cargar» --es la convención de un hueco o una zona para
// soltar archivos-- y un estado vacío no es eso: es una respuesta completa.
// La zona de soltar fotos de «Subir libreta» SÍ sigue punteada, por lo mismo
// al revés, y por eso no entra aquí.
//
// ===========================================================================
// EL TÍTULO ES 16 SEMIBOLD Y EL SUBTÍTULO 12
//
// Del frame. El salto importa: con los dos en 14 --como estaban varios-- el
// bloque se lee como un párrafo y no como «un titular y su explicación»,
// que es lo que hace que alguien lo lea de un vistazo en vez de leerlo entero.
// ===========================================================================
// EL TÍTULO ES OPCIONAL DESDE EL 2026-10-23
//
// *«El empty state muestra el mensaje con el texto del subtítulo, no del
// título»* — dueño, hablando de la lista que un filtro deja vacía. Y tiene
// sentido donde lo pidió: ahí el mensaje no es un titular que anuncia una
// pantalla nueva —«Todavía no hay transacciones»— sino una explicación de por
// qué no se ve nada ahora mismo, con los chips que lo causaron justo encima.
// En 16 semibold se lee como un error; en 12 gris, como lo que es.
//
// El de verdad vacío —el cliente sin una sola transacción— conserva su título
// y su subtítulo, que es para lo que nació este componente.
export function EmptyState({
  title,
  subtitle,
  // LOS BOTONES, «en el caso que aplique». Van en una columna de ancho
  // completo porque el frame los dibuja así, y porque un botón a medio ancho
  // dentro de una caja centrada no tiene dónde alinearse.
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-[10px] border px-4 py-6",
        className,
      )}
    >
      <div className="flex w-full flex-col items-center gap-1">
        {title ? <p className="text-center text-base leading-6 font-semibold">{title}</p> : null}
        {subtitle ? (
          <p className="text-center text-xs leading-4 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children ? <div className="flex w-full flex-col gap-4">{children}</div> : null}
    </div>
  );
}
