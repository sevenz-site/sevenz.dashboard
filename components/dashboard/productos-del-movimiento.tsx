import type { SaleLineRow } from "@/lib/sale-lines";

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
  formatearMonto,
}: {
  productos: SaleLineRow[];
  formatearMonto: (monto: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* AQUÍ ESTUVO «Se llevó» CON LA SUMA DE LOS PRODUCTOS, retirada el
          2026-10-20: *«el campo "Se llevó" no existe»*. Los frames
          `1463:18100` y `1479:9456` dibujan las líneas de producto solas,
          dentro de «Resumen de compra», sin rótulo encima y sin total.

          Y EL TOTAL NO SE PIERDE DE VISTA: la fila «Total por cobrar» del
          mismo recuadro lo lleva. Lo que se quita es la suma de las líneas,
          que es otra cifra —puede no cuadrar con el monto guardado— y de eso
          se encarga la frase de abajo. */}
      <ul className="flex flex-col gap-0.5">
        {productos.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-4 py-1">
            {/* EL NOMBRE ES EL RÓTULO Y LA CANTIDAD EL VALOR, en ese peso y no
                al revés: en el frame `<nombre de producto>` va en 12 y gris
                —como «Plazo de pago» o «Descripción»— y `00 x $00.00` en 14 y
                negro, a la derecha. Es la misma anatomía que el resto de filas
                de la ficha, y por eso la lista se lee como parte de ella. */}
            <span className="min-w-0 break-words text-xs leading-4 text-muted-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-sm leading-5 tabular-nums">
              {p.quantity} × {formatearMonto(p.unitPrice)}
            </span>
          </li>
        ))}
      </ul>

      {/* AQUÍ ESTUVO «Se registró X menos que la suma de los productos»,
          retirada el 2026-10-20 por instrucción del dueño. No está en ninguno
          de los tres frames; la escribí yo.

          LO QUE EXPLICABA, por si alguien se la encuentra en el historial: el
          dueño decidió el 2026-10-17 que el monto se calcule desde los
          productos pero SE PUEDA CORREGIR, así que las dos cifras pueden no
          cuadrar. La frase ponía la diferencia a la vista. Quien la quiera
          de vuelta, que la pida: la aritmética sigue siendo cierta. */}
    </div>
  );
}
