import { formatDateTime } from "@/lib/format";

// DE DÓNDE VINO ESTA TRANSACCIÓN Y CUÁNTO SE TARDÓ EN ATENDERLA.
//
// Pedido por el dueño el 2026-10-25, para el detalle de una transacción
// registrada: la fecha en que el pedido ENTRÓ por el catálogo, la fecha en
// que él lo REGISTRÓ, y el tiempo entre las dos.
//
// ===========================================================================
// POR QUÉ ESTAS TRES LÍNEAS Y NO UNA
//
// La fecha de arriba de la pantalla es la de la VENTA, que es cuándo se
// escribió el dinero. Un pedido que llegó el lunes y se registró el jueves
// tiene dos fechas distintas y la pantalla solo contaba una — así que decía
// la verdad y escondía la mitad que el tendero usa para saber si está
// tardando.
//
// EL TIEMPO DE RESPUESTA SE CALCULA, NO SE GUARDA: es la resta de las dos
// fechas. Guardarlo sería una tercera copia de un dato que ya está dos veces,
// y la primera vez que alguien corrigiera una fecha a mano quedaría mintiendo.
//
// ===========================================================================
// SOLO SALE SI LA TRANSACCIÓN VIENE DE UN PEDIDO
//
// Una venta tecleada en el mostrador no tiene nada que contar aquí, y una
// sección vacía con guiones se lee como un dato que falta. El componente
// devuelve `null` y la pantalla no reserva nada.

export function CatalogOrderTrace({
  recibidoEl,
  registradoEl,
}: {
  recibidoEl: string | null;
  // `null` mientras el pedido va por la mitad --con dos monedas, la primera
  // venta existe antes de que el pedido esté terminado--. Entonces se enseña
  // la primera línea y no la segunda, en vez de inventar una fecha.
  registradoEl: string | null;
}) {
  if (!recibidoEl) return null;

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        Transacción recibida desde el catálogo el {formatDateTime(recibidoEl)}.
      </p>
      {registradoEl ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            Registrada desde el catálogo el {formatDateTime(registradoEl)}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Tiempo de respuesta: {tiempoDeRespuesta(recibidoEl, registradoEl)}
          </p>
        </>
      ) : null}
    </div>
  );
}

// «2 días, 03:15» — y sin los días cuando no los hay, que es el «(si aplica)»
// del encargo. Un «0 días» delante de la hora es ruido en el caso corriente:
// casi todos los pedidos se registran el mismo día.
//
// SE TRUNCA, NO SE REDONDEA. «1 día» para algo que lleva 1 día y 23 horas
// diría la verdad de una forma que engaña; con horas y minutos al lado, el
// número de días es el entero que ya pasó.
//
// UN RESULTADO NEGATIVO SE TRATA COMO CERO. No debería ocurrir --registrar va
// después de recibir-- pero una fecha corregida a mano o un reloj de servidor
// movido lo harían posible, y «-1 días» en pantalla se lee como una avería de
// la app en vez de como lo que es.
export function tiempoDeRespuesta(desde: string, hasta: string): string {
  const ms = Math.max(0, new Date(hasta).getTime() - new Date(desde).getTime());
  const minutosTotales = Math.floor(ms / 60_000);
  const dias = Math.floor(minutosTotales / (60 * 24));
  const horas = Math.floor((minutosTotales % (60 * 24)) / 60);
  const minutos = minutosTotales % 60;
  const reloj = `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
  if (dias === 0) return reloj;
  return `${dias} ${dias === 1 ? "día" : "días"}, ${reloj}`;
}
