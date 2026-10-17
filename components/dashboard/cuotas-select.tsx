"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// EN CUÁNTAS CUOTAS SE PACTÓ EL FIADO. Decisión del dueño, 2026-10-17.
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
}: {
  value: string;
  onValueChange: (value: string) => void;
  // El plazo que hay elegido ahora mismo, en días. null = «sin especificar».
  plazoDias: number | null;
}) {
  if (plazoDias === null) return null;

  const cuotas = Number(value) || 1;
  // Los mismos decimales que la base: 30 días en 4 cuotas son 7,5 días, no 7.
  // Redondear aquí haría que la pantalla prometa una fecha y la base calcule
  // otra.
  const cadaCuantos = plazoDias / cuotas;
  const legible = Number.isInteger(cadaCuantos)
    ? String(cadaCuantos)
    : cadaCuantos.toFixed(1).replace(".", ",");

  return (
    <div className="flex flex-col gap-2">
      <Label>Cuotas</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Elige cuántas cuotas" />
        </SelectTrigger>
        <SelectContent>
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
      {cuotas > 1 ? (
        <p className="text-xs text-muted-foreground">
          Las cuotas se reparten dentro del plazo: {cuotas} cuotas en {plazoDias} días es una
          cuota cada {legible} {legible === "1" ? "día" : "días"}.
        </p>
      ) : null}

      {/* El valor viaja en un hidden, igual que el del plazo: un solo campo,
          un solo nombre, y el servidor no tiene que saber nada del control. */}
      <input type="hidden" name="cuotas" value={value} />
    </div>
  );
}
