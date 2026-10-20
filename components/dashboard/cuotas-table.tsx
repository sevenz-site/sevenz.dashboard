import { formatDate } from "@/lib/format";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import { estadosDelFiado, type AbonoParaEstado } from "@/lib/estado-del-plazo";

// THE AGREED CUOTAS, ONE PER LINE, WITH THE DATE EACH ONE FALLS DUE.
//
// Asked for by the owner on 2026-10-16, replacing the single line that read
// "2 cuotas, una cada 3,5 días". That line made him do the arithmetic himself
// and, worse, do it from the charge's date -- which is the one thing on the
// card he had to scroll up to find. A cuota is a date the client has to meet;
// printing the interval instead of the dates described the rule and hid the
// answer.
//
// A REAL TABLE AND NOT MORE `Fila`s, because these rows have columns that mean
// the same thing down the list -- a date under a date, an amount under an
// amount -- and `Fila` is built for label/value pairs that have nothing to do
// with each other.
//
// NO HORIZONTAL SCROLL AT 375px, which the owner asked for by name. The number
// column is the narrowest thing that can carry "12", the date is given room
// and the amount is pinned right with `tabular-nums` so the digits line up.
// Nothing here can outgrow its track: the longest date in Spanish is
// "30 de sept de 2026" and the amounts are the charge's own split.
export function CuotasTable({
  createdAt,
  plazoDias,
  cuotas,
  amount,
  formatearMonto,
  abonoInicial = 0,
  abonos = [],
}: {
  createdAt: string;
  plazoDias: number;
  cuotas: number;
  amount: number;
  // LO ABONADO, para la columna «Estado» que pidió el dueño el 2026-10-20
  // (frame `1489:10209`, nodo `1488:10146`). Sin esto la tabla no puede
  // distinguir una cuota pagada de una vencida, que es justo lo que la
  // columna contesta.
  //
  // Por defecto cero y vacío: una superficie que no sabe lo abonado --la
  // ficha de un movimiento BORRADO, que no tiene reparto-- dibuja todas las
  // cuotas como pendientes, que es lo único que puede afirmar.
  abonoInicial?: number;
  abonos?: AbonoParaEstado[];
  // THE CALLER FORMATS, and that is not indirection for its own sake: the two
  // cards that mount this table format differently on purpose -- the live
  // movement's shows the bolívar equivalent underneath, the deleted one does
  // not, because it has no rate to show it with. Taking a currency here and
  // formatting it inside would have made this table guess, and the guess for a
  // missing ledger is Colombian pesos -- printing a dollar fiado as pesos.
  formatearMonto: (monto: number) => string;
}) {
  const { cuotas: filas } = estadosDelFiado({
    createdAt,
    plazoDias,
    cuotas,
    amount,
    abonoInicial,
    abonos,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* LA FILA «Cuotas», AL LADO DE «Plazo de pago» Y CON SU MISMA FORMA.
          Frames `1463:18100` y `1479:9456`: dicen «00 cuotas» y nada más.

          DECÍA «3 cuotas dentro de 30 días» hasta el 2026-10-20. La frase era
          mía, no del frame: explicaba de dónde salen las fechas. Lo explica la
          tabla de abajo, que las enseña — y el plazo ya está escrito en la
          fila justo encima, así que la frase lo repetía. */}
      <div className="flex items-baseline justify-between gap-4 py-1">
        <span className="text-xs leading-4 text-muted-foreground">Cuotas</span>
        <span className="text-sm leading-5 tabular-nums">{cuotas} cuotas</span>
      </div>

      {/* «Próximas cuotas» SIN RECUADRO Y EN 16 SEMIBOLD, que es como lo
          dibuja el frame `1489:10209` (nodos `1489:10451` y `1489:10452`).

          TUVO RECUADRO Y TÍTULO DE 14 hasta el 2026-10-20. No fue un capricho
          quitarlo: la tarjeta de la moneda que lo contiene también perdió el
          suyo ese día y pasó a separarse con una línea superior, así que un
          recuadro aquí dentro habría quedado como el único marco de la
          pantalla. */}
      <div className="flex flex-col gap-2">
        <p className="py-2 text-base leading-6 font-semibold">Próximas cuotas</p>
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b text-sm leading-5">
              {/* «N°» Y NO «#», que es lo que decía. Es el rótulo del frame, y
                  además se lee en voz alta — «número» — donde «#» no. */}
              <th scope="col" className="w-8 text-left font-normal">
                N°
              </th>
              <th scope="col" className="text-left font-normal">
                Vence
              </th>
              <th scope="col" className="text-right font-normal">
                Monto
              </th>
              {/* LA CUARTA COLUMNA, del frame `1488:10146`.

                  `w-32` Y LA FECHA PUEDE PARTIRSE, por instrucción del dueño
                  el 2026-10-20 con una captura: *«los chips del estado de la
                  cuota se rompen, dale más ancho, no deben romperse, de ser
                  necesario la fecha puede ir en dos líneas»*.

                  Estuvo en `w-24` unas horas, y fue mi error de prioridades:
                  ensanché «Vence» para que la fecha no se partiera y el chip
                  se partió en su lugar. Una fecha en dos líneas se sigue
                  leyendo; una pastilla partida parece la pantalla rota.

                  128px es lo que pide «Dentro del plazo» --la etiqueta más
                  larga-- a 12px con sus 6 de relleno a cada lado. */}
              <th scope="col" className="w-32 text-right font-normal">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.numero} className="text-xs leading-4">
                <td className="py-1 tabular-nums">{c.numero}</td>
                <td className="py-1">{formatDate(c.fecha.toISOString())}</td>
                <td className="py-1 text-right tabular-nums">{formatearMonto(c.monto)}</td>
                <td className="py-1 text-right">
                  <ChipDeEstado estado={c.estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
