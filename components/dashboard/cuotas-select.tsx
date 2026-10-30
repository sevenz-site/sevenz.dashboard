"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatCadaCuantosDias } from "@/lib/format";

// EN CUÁNTAS CUOTAS SE PACTÓ EL FIADO. Decisión del dueño, 2026-10-16.
//
// LA REGLA, Y ES SUYA LITERAL: *«las cuotas deberían dividirse entre el plazo
// establecido, por ejemplo, selecciona 3 cuotas en 30 días, entonces sería
// una cuota cada 10 días»*. O sea que el plazo NO se multiplica: se reparte.
// Un fiado a 30 días en 3 cuotas sigue venciendo del todo a los 30.
//
// Y pidió que eso se dijera en el producto, no solo en el código: de ahí la
// línea de abajo del selector, que calcula el número y lo enseña. Un control
// que reparte un plazo sin decir en cuánto queda cada parte obliga al tendero
// a hacer la división de cabeza, y es justo la cuenta que lo hace dudar de si
// entendió bien.
//
// SE ESCONDE SIN PLAZO, no se deshabilita. Sin plazo no hay nada que dividir
// —la migración `118` lo rechaza en la base— y un campo apagado invita a
// preguntarse qué hay que hacer para encenderlo. Si no se puede, no está.
//
// «1 cuota» NO es una opción porque no significa nada distinto de lo de
// siempre: un fiado de una sola cuota vence al final de su plazo. El valor
// por defecto es "1" y el servidor lo guarda como null, que es el caso N=1
// de la migración.

const MAXIMO = 12;

export function CuotasSelect({
  value,
  onValueChange,
  plazoDias,
  sinEspecificar = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  // El plazo que hay elegido ahora mismo, en días. null = «sin especificar».
  plazoDias: number | null;
  // «SIN ESPECIFICAR» COMO OPCIÓN, SOLO EN LA DEUDA ANTIGUA — decisión del
  // dueño el 2026-10-30, frame `1868:16119`: *«Cuotas tendrá la opción "Sin
  // especificar" solo en este flujo»*. Quien pasa a mano una libreta muchas
  // veces no sabe en cuántas partes se pactó, y «Pago único» afirmaría algo
  // que no sabe. Se guarda igual que «Pago único» —null— porque la base no
  // distingue las dos; lo que cambia es lo que el tendero declara.
  //
  // Y CON ÉL EL CAMPO SE VE AUNQUE NO HAYA PLAZO, porque el frame lo dibuja
  // así. En el resto de pantallas sigue escondiéndose, como explica la cabecera.
  //
  // CON TODAS LAS OPCIONES, TAMBIÉN SIN PLAZO — encargo del dueño el
  // 2026-10-30: además de «Sin especificar», las mismas que un fiado. Hasta
  // ese día, sin plazo solo ofrecía «Sin especificar», que es lo único que la
  // base admite sin plazo (migración `118`). Ahora se pueden elegir y, si se
  // eligen cuotas sin plazo, el aviso de abajo lo dice en rojo y el servidor
  // rechaza el guardado con la misma frase (`leerDeudaAntigua`). Callarse y
  // guardar sin cuotas habría tirado lo que el tendero eligió sin decírselo.
  sinEspecificar?: boolean;
}) {
  if (plazoDias === null && !sinEspecificar) return null;

  const cuotas = Number(value) || 1;
  // The division lives in `formatCadaCuantosDias`, which carries why it never
  // rounds. The saved movement's card shows the DATES instead of the interval
  // (`lib/cuotas.ts`) -- same rule, and here there is no date to show yet.
  const cadaCuantos = plazoDias === null ? null : formatCadaCuantosDias(plazoDias, cuotas);

  return (
    <div className="flex flex-col gap-2">
      <Label>Cuotas</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Elige cuántas cuotas" />
        </SelectTrigger>
        <SelectContent>
          {sinEspecificar ? <SelectItem value="sin_especificar">Sin especificar</SelectItem> : null}
          <SelectItem value="1">Pago único</SelectItem>
          {Array.from({ length: MAXIMO - 1 }, (_, i) => i + 2).map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} cuotas
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* EL AVISO QUE PIDIÓ EL DUEÑO. Con pago único no se enseña: ahí no hay
          ningún reparto que explicar, y una línea que dice lo obvio entrena a
          no leer las que sí importan. */}
      {cuotas > 1 && plazoDias === null ? (
        <p className="text-xs text-destructive">
          Para repartir la deuda en cuotas, elige primero el plazo de pago.
        </p>
      ) : cuotas > 1 ? (
        <p className="text-xs text-muted-foreground">
          Las cuotas se reparten dentro del plazo: {cuotas} cuotas en {plazoDias} días es una
          cuota cada {cadaCuantos}.
        </p>
      ) : null}

      {/* El valor viaja en un hidden, igual que el del plazo: un solo campo,
          un solo nombre, y el servidor no tiene que saber nada del control. */}
      <input type="hidden" name="cuotas" value={value} />
    </div>
  );
}
