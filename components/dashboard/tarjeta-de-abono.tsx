"use client";

import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AbonoAcciones } from "@/components/dashboard/abono-acciones";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import type { EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { CLASE_TARJETA } from "@/components/dashboard/tarjeta-de-fiado";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { getBalanceLabel } from "@/lib/types";

// UN ABONO, COMO TARJETA. El reflejo de `TarjetaDeFiado`.
//
// Encargo del dueño el 2026-10-20: *«Detalle de los fiados también deben
// mostrar la lista de lo que se ha abonado (mismo patrón como abono muestra
// los fiados)»*. Desde el 2026-10-19 el detalle de un abono enseña la tarjeta
// del fiado que pagó; esto es la misma relación leída al revés.
//
// COMPARTE LA FORMA Y NO EL COMPONENTE, y conviene saber por qué se decidió
// así en vez de añadirle un modo a `TarjetaDeFiado`: las dos tarjetas dicen
// cosas distintas en los mismos huecos —una lleva «Debe $X» debajo de la fecha
// y la otra no lleva nada ahí; una suma en rojo y la otra resta en azul— y un
// solo componente con un `if` por cada hueco acaba siendo más difícil de leer
// que dos de veinte líneas. Lo que NO se duplica es la cadena de clases, que
// viene de `CLASE_TARJETA`: es lo único que tiene que seguir siendo idéntico
// para que las dos se vean como la misma cosa.
export type AbonoDirigido = {
  movementId: string;
  fecha: string;
  currency: PriceCurrency | null;
  amount: number;
  descripcion: string | null;
  // LA TASA QUE ESTE ABONO SELLÓ, para los bolívares «al día del abono».
  // `null` en un negocio colombiano y en todo lo anterior al sellado.
  tasaSellada?: number | null;
  // EN QUÉ MONEDA SE TECLEÓ Y CUÁNTO, para el diálogo de editar: se edita en
  // la misma moneda que se usó, no en la del libro. Un abono escrito como
  // «Bs. 900» guardó 900 aquí y $1,08 en `amount`; dejar editar solo el dólar
  // convertiría ese respaldo en mentira.
  entryCurrency?: "VES" | PriceCurrency | null;
  entryAmount?: number | null;
  // Lo máximo que admite su fiado contando este abono, para el tope del
  // diálogo. `null` en un abono sin dirigir.
  techo?: number | null;
};

export function TarjetaDeAbono({
  abono,
  estado,
  inicial = false,
  pendienteTras = null,
}: {
  abono: AbonoDirigido;
  // Siempre navega. A diferencia de la del fiado, esta tarjeta no tiene el uso
  // de «elegir uno» dentro de un flujo, así que no necesita `onClick`.
  // EL ESTADO DE LA CUOTA QUE ESTE ABONO CUBRIÓ — frame `1489:10209`, y es la
  // respuesta del dueño del 2026-10-20 a qué mide el chip. `undefined` cuando
  // el fiado no tiene plazo: no hay fecha contra la que juzgar y no se dibuja.
  estado?: EstadoDelPlazo;
  // ── LA PRIMERA TARJETA: LO QUE ENTREGÓ AL COMPRAR ────────────────────
  //
  // Frame `1510:9784`, encargo del dueño el 2026-10-21. Va al principio de la
  // lista y se diferencia en tres cosas: su chip es gris y dice «Al día de la
  // compra», su línea de bolívares también, y NO lleva «⋮».
  //
  // SIN MENÚ, Y ESO NO ES UN OLVIDO DEL FRAME: ese pago no es un movimiento
  // suyo —vive en `sale_payments`, por la migración `124`— así que no se puede
  // editar ni borrar por separado. Lo que se edita es la venta. Ofrecer un
  // menú que no puede hacer nada sería peor que no tenerlo.
  //
  // EL CHIP ES GRIS Y NO AZUL porque no juzga nada. Los otros dicen si el
  // abono llegó dentro del plazo; este se pagó en el mismo acto de comprar, y
  // «Dentro del plazo» sobre un pago simultáneo es una obviedad disfrazada de
  // veredicto.
  inicial?: boolean;
  // ── LO QUE QUEDABA DE ESTE FIADO DESPUÉS DE ESTE ABONO ───────────────
  //
  // Encargo del dueño el 2026-10-21: *«les falta el label con la bandera
  // "Debe" al igual que las filas del historial»*.
  //
  // DEL FIADO Y NO DEL CLIENTE, preguntado y decidido por él entre las dos:
  // toda esta pantalla habla de un fiado, así que la cifra se comprueba
  // restando dentro de la misma tarjeta. El saldo del cliente mezclaría aquí
  // deudas de otras compras y la resta no cuadraría con lo que se ve.
  //
  // `null` donde no se puede saber —la tarjeta de la compra, o un entorno sin
  // la migración `132`— y entonces la línea no se dibuja.
  pendienteTras?: number | null;
}) {
  // «Bs. … AL DÍA DEL ABONO», con la tasa SELLADA en el movimiento y no la de
  // hoy — frame `1489:10209`, nodo `1489:10240`.
  //
  // LLEVABA LA TASA DE HOY hasta el 2026-10-20, copiando la tarjeta del fiado,
  // y ahí la pregunta sí es «cuánto es esto hoy». Aquí es otra: ese dinero ya
  // cambió de manos. Decirle al tendero que su abono de hace dos meses «son»
  // los bolívares de hoy es contarle una conversión que nunca ocurrió.
  //
  // Sale de la tasa que el propio abono tiene guardada. Sin ella no se dibuja
  // la línea: inventar una conversión es peor que no darla, y un movimiento
  // anterior a que existiera el sellado no la tiene.
  const enBs =
    abono.tasaSellada != null ? abono.amount * abono.tasaSellada : null;

  return (
    // ── ESTA TARJETA NO SE TOCA: NO LLEVA ENLACE ───────────────────────
    //
    // Reportado por el dueño el 2026-10-21: *«al seleccionar un abono me abre
    // el detalle del abono, eso está mal, quedamos que el abono no tendrá
    // detalle, la card no es clickeable, solo los botones "more"»*.
    //
    // Envolvía todo su contenido en un `<Link>` al detalle del abono, que es
    // una pantalla que esta decisión deja sin puerta de entrada desde aquí.
    // Y tenía sentido cuando se escribió —el frame viejo dibujaba un chevron—
    // pero el chevron ya se había sustituido por el «⋮» el 2026-10-20, y el
    // enlace se quedó debajo: invisible, y disparándose en todo el ancho de la
    // tarjeta salvo en el propio menú.
    //
    // POR QUÉ IMPORTA MÁS QUE UNA NAVEGACIÓN DE MÁS: lo único que el dueño
    // puede hacer con un abono es editarlo o borrarlo, y las dos están en el
    // «⋮». Un toque en cualquier otro punto se lo llevaba de la ficha del
    // fiado que estaba leyendo, sin haber pedido nada.
    <div className={`${CLASE_TARJETA} gap-2`}>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      {/* LA FECHA ARRIBA Y EL CHIP DEBAJO, sin título — frame `1489:10209`,
          nodos `1489:10233` y el `chip_info` de al lado.

          LLEVABA «Abono · descripción» y la fecha pequeña debajo, copiando la
          fila del historial. El frame no lo pide: dentro de la ficha de su
          fiado ya se sabe que son abonos, así que repetir la palabra en cada
          tarjeta no distingue ninguna de otra. Lo que las distingue es cuándo
          se pagaron y si llegaron a tiempo. */}
      {/* `shrink-0` Y LA FECHA SIN PARTIR. Medido a 375px el 2026-10-20: con
          `min-w-0` la columna cedía y «20 de oct de 2026» caía en dos líneas,
          que es lo que identifica cada tarjeta de la lista. Lo que cede ahora
          es la línea de bolívares de la derecha, que es la que sobra. */}
      {/* `items-start` Y NO SOLO `flex-col`. Reportado por el dueño el
          2026-10-21: *«los chips de los cards de los abonos están torcidos,
          deben apretar el contenido, pero se ven con más espacio de un lado
          que del otro»*.

          La causa: en una columna flex los hijos se estiran a lo ancho por
          defecto (`align-items: stretch`), así que el chip tomaba el ancho de
          la FECHA, que es más larga. Su `px-1.5` quedaba a la izquierda y el
          resto era aire a la derecha — el chip no estaba torcido, estaba
          estirado, y su texto pegado a un lado.

          Es el mismo mecanismo que el `text-right` de la línea de bolívares,
          dos días antes: alinear la caja no es alinear lo que lleva dentro. */}
      <div className="flex shrink-0 flex-col items-start gap-1">
        <span className="whitespace-nowrap text-sm leading-5">{formatDate(abono.fecha)}</span>
        {inicial ? (
          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-transparent bg-accent px-1.5 py-px text-xs leading-4">
            Al día de la compra
          </span>
        ) : estado ? (
          <ChipDeEstado estado={estado} />
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-col items-end">
          {/* AZUL Y CON «+» — frame `1479:9456`, nodos `1479:9641` y
              `1479:9700`: `+$00.00` en `#0062fb`.

              LLEVABA «−» Y ERA MÍO. El razonamiento parecía bueno —un abono
              resta de la deuda— pero el frame dibuja «+» en las dos tarjetas,
              igual que la del fiado dentro de un abono (`1465:18552`, en
              rojo). El signo aquí no es el del saldo: es el de la cifra que se
              suma a lo abonado. Lo que distingue a las dos tarjetas es el
              color, no el signo. */}
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
            {abono.currency ? (
              <CurrencyFlagIcon currency={abono.currency} className="size-3.5 shrink-0" />
            ) : null}
            +{formatPriceAmount(abono.amount, abono.currency ?? "COP")}
          </span>
          {enBs != null ? (
            // `text-right` Y NO SOLO `items-end`. Reportado por el dueño el
            // 2026-10-21 con la segunda tarjeta de su captura: `items-end`
            // alinea la CAJA, no el texto de dentro. Mientras la línea cabe
            // entera —«Bs. 996,52 al día del abono»— la caja mide lo que el
            // texto y las dos cosas coinciden; en cuanto se parte en dos
            // —«Bs. 17.621,33 al día del abono»— la caja ocupa todo el ancho
            // disponible y el texto se queda a la izquierda, su valor por
            // defecto. Dos tarjetas iguales alineadas distinto según lo largo
            // que fuera el número.
            <span className="text-right text-[10px] text-muted-foreground tabular-nums">
              {formatBs(enBs)} al día {inicial ? "de la compra" : "del abono"}
            </span>
          ) : null}
          {/* EL RÓTULO CON SU BANDERA, como en las filas del historial.
              `getBalanceLabel` elige entre «Debe», «A favor» y «Sin deuda»
              según el signo — un fiado saldado dirá «Sin deuda», que es la
              respuesta correcta y no un cero suelto.

              SIN SIGNO: el rótulo ya lo lleva, como se decidió el 2026-10-21
              para los saldos a favor de la pantalla del cliente. */}
          {pendienteTras != null ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
              {abono.currency ? (
                <CurrencyFlagIcon currency={abono.currency} className="size-3 shrink-0" />
              ) : null}
              {getBalanceLabel(pendienteTras)}{" "}
              {formatPriceAmount(Math.abs(pendienteTras), abono.currency ?? "COP")}
            </span>
          ) : null}
        </div>
      </div>
      </div>
      {/* EL «⋮» SUSTITUYE AL CHEVRON del frame viejo. Los dos vivían en el
          mismo sitio y los dos dicen «aquí hay más»; el chevron lo decía de la
          navegación, que ya la tiene el enlace de al lado, y el menú lo dice
          de las dos acciones que el dueño pidió el 2026-10-20. */}
      {inicial ? null : (
      <AbonoAcciones
        movementId={abono.movementId}
        montoTecleado={abono.entryAmount ?? abono.amount}
        monedaTecleada={abono.entryCurrency ?? abono.currency}
        techo={abono.techo ?? null}
        monedaDelLibro={abono.currency}
      />
      )}
    </div>
  );
}
