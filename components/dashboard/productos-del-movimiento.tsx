import { totalDeLineas, type MovementProductRow } from "@/lib/movement-products";

// QUÉ SE LLEVÓ EL CLIENTE, en la ficha de un movimiento ya guardado.
//
// LA FILA DE LA DIFERENCIA ES EL MOTIVO DE ESTE COMPONENTE, y no la lista.
// El dueño decidió el 2026-10-17 que el monto se calcule desde los productos
// pero SE PUEDA CORREGIR, y lo que viene con esa decisión es que las dos
// cifras pueden no cuadrar: tres cafés a 4,50 son 13,50 y el fiado dice 13
// porque redondeó. El peor resultado de permitirlo era que nadie supiera cuál
// manda, así que la diferencia se enseña en vez de esconderse.
//
// Y SE ENSEÑA SIN JUZGARLA. No es un error ni un aviso: es la rebaja que él
// hizo, escrita donde se puede comprobar. Pintarla en rojo convertiría un
// descuento deliberado en algo que parece estar mal.
//
// NO LLEVA EL PRECIO UNITARIO EN UNA COLUMNA APARTE como la tabla de cuotas:
// aquí la cantidad y el precio van en la misma línea («3 × $4,50»), porque lo
// que se lee de un tirón es qué se llevó y cuánto costaba cada uno, y una
// tercera columna con el subtotal obliga a decidir cuál de las tres mirar.
export function ProductosDelMovimiento({
  productos,
  amount,
  formatearMonto,
}: {
  productos: MovementProductRow[];
  // El monto que quedó guardado en el movimiento, que es la verdad del dinero.
  amount: number;
  formatearMonto: (monto: number) => string;
}) {
  const total = totalDeLineas(productos);
  // Un céntimo de margen: el total se redondea a dos decimales y el monto
  // puede traer los suyos, así que una diferencia de 0,001 no es una rebaja,
  // es aritmética.
  const diferencia = Math.round((total - amount) * 100) / 100;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4 text-xs leading-5">
        <span className="text-muted-foreground">Se llevó</span>
        <span className="tabular-nums text-muted-foreground">{formatearMonto(total)}</span>
      </div>

      <ul className="flex flex-col gap-0.5 text-xs leading-5">
        {productos.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 break-words">{p.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {p.quantity} × {formatearMonto(p.unitPrice)}
            </span>
          </li>
        ))}
      </ul>

      {diferencia !== 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {diferencia > 0
            ? `Se registró ${formatearMonto(Math.abs(diferencia))} menos que la suma de los productos.`
            : `Se registró ${formatearMonto(Math.abs(diferencia))} más que la suma de los productos.`}
        </p>
      ) : null}
    </div>
  );
}
