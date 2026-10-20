import { calcularCuotas } from "@/lib/cuotas";
import { formatDate } from "@/lib/format";

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
}: {
  createdAt: string;
  plazoDias: number;
  cuotas: number;
  amount: number;
  // THE CALLER FORMATS, and that is not indirection for its own sake: the two
  // cards that mount this table format differently on purpose -- the live
  // movement's shows the bolívar equivalent underneath, the deleted one does
  // not, because it has no rate to show it with. Taking a currency here and
  // formatting it inside would have made this table guess, and the guess for a
  // missing ledger is Colombian pesos -- printing a dollar fiado as pesos.
  formatearMonto: (monto: number) => string;
}) {
  const filas = calcularCuotas({ createdAt, plazoDias, cuotas, amount });

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

      {/* «Próximas cuotas», EN SU PROPIO RECUADRO. El frame lo dibuja con el
          mismo borde y el mismo radio que «Resumen de compra», con su título
          dentro. Iba sin recuadro y sin título, pegado a la fila de arriba:
          se leía como la continuación de «Cuotas» y no como lo que es, una
          tabla con su propia cabecera. */}
      <div className="flex flex-col gap-2 rounded-[10px] border p-2.5">
        <p className="py-2 text-sm leading-5">Próximas cuotas</p>
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
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.numero} className="text-xs leading-4">
                <td className="py-1 tabular-nums">{c.numero}</td>
                <td className="py-1">{formatDate(c.fecha.toISOString())}</td>
                <td className="py-1 text-right tabular-nums">{formatearMonto(c.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
