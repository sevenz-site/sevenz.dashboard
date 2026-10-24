"use client";

import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { BotonCopiarCodigo } from "@/components/dashboard/boton-copiar-codigo";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
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
  // EL CÓDIGO DE SU TRANSACCIÓN — migración 147, encargo del dueño el
  // 2026-10-23: *«Para los abonos asociados a fiados dentro de fiados
  // aparecerán en el footer de la card dentro del fiado»*.
  //
  // Es el de la TRANSACCIÓN, no el del abono: un pago repartido entre tres
  // fiados deja tres tarjetas como esta, en tres fichas distintas, y las tres
  // llevan el mismo código. Buscarlo es lo que las vuelve a juntar, que es
  // justo para lo que este código existe.
  transactionCode?: string | null;
  // Lo máximo que admite su fiado contando este abono, para el tope del
  // diálogo. `null` en un abono sin dirigir.
};

export function TarjetaDeAbono({
  abono,
  href = null,
  estado,
  inicial = false,
  pendienteTras = null,
  conAcciones,
}: {
  abono: AbonoDirigido;
  // ── A DÓNDE LLEVA LA TARJETA ────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-23: *«al seleccionar un abono de esa sección
  // de abonos seleccionados redirigirá al detalle del abono»*, con el frame
  // `1510:9784` — que dibuja un chevron a la derecha y ningún «⋮».
  //
  // CON `href` LA TARJETA NAVEGA Y PIERDE EL MENÚ, las dos cosas a la vez y
  // no por separado: las acciones de un abono (editar, eliminar) se mudan a
  // su propia ficha, que es donde el frame las pone. Dejar el «⋮» aquí
  // además del enlace sería lo que el dueño mandó quitar el 2026-10-21 —
  // dos cosas tocables en una fila apuntando a sitios distintos.
  //
  // DESPLAZA SU DECISIÓN DEL 2026-10-21 —*«la card no es clickeable, solo los
  // botones "more"»*— y queda escrito que aquello tenía sentido entonces: el
  // abono no iba a tener ficha propia, así que el enlace no llevaba a ningún
  // sitio útil. Ahora la tiene.
  //
  // `null` deja la tarjeta como estaba: es el abono de la compra, que no es
  // un movimiento y no tiene ficha que abrir.
  href?: string | null;
  // EL RESALTADO SE FUE EL 2026-10-23, y queda escrito por qué estuvo: entre
  // el 2026-10-22 y ese día, la fila de un abono en el historial abría la
  // ficha de su FIADO con `?abono=`, y el tendero aterrizaba entre tres
  // tarjetas casi iguales sin saber cuál era la suya. El relleno se la decía.
  //
  // Ya no hace falta: esa fila abre la ficha del propio abono, así que nadie
  // llega aquí buscando una tarjeta. El dueño lo pidió quitar al ver que
  // seguían saliendo con fondo oscuro.
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
  // ── ¿HAY «⋮»? SOLO EN LA PANTALLA DEL DUEÑO ─────────────────────────
  //
  // Reportado por el dueño el 2026-10-21 con una captura de `dev.sevenz.site`
  // abierta como CLIENTE: *«vista de cliente muestra botón "more" y opciones
  // de editar y eliminar el abono, está mal»*. Tiene razón, y además son
  // acciones que no son suyas.
  //
  // QUÉ PASABA DE VERDAD SI LAS TOCABA: nada. `deleteMovement` pide sesión y
  // comprueba que el cliente sea del dueño que llama, así que le habría
  // contestado «Sesión expirada, vuelve a entrar». No era una fuga; era
  // ofrecerle una puerta que no abre. (Hasta el 2026-10-23 el menú traía
  // además «Editar abono» y valía lo mismo para su acción.)
  //
  // OBLIGATORIA Y SIN VALOR POR DEFECTO, igual que `conAbono` en
  // `movement-type-filter.tsx` y por lo que allí costó: un `= true` devolvería
  // el menú a la pantalla del cliente en silencio el día que alguien monte
  // esta tarjeta en un sitio nuevo y no se acuerde de pasarla. Así no compila.
  conAcciones: boolean;
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
  // ── LOS BOLÍVARES DE ESTE ABONO: LOS TECLEADOS, SI LOS HAY ──────────
  //
  // Decisión del dueño el 2026-10-23: *«Vamos con los bolívares tecleados,
  // son los que deben mandar»*.
  //
  // QUÉ COSTABA LA OTRA FORMA, medido ese día: esta tarjeta enseñaba
  // `amount × tasaSellada` mientras la fila del historial enseñaba lo
  // tecleado, así que el MISMO abono salía como Bs. 4.111,39 aquí y Bs.
  // 4.113,77 allí. Las dos eran ciertas —Bs. 4.113,77 entre 993,09 da €4,1424
  // y el libro solo guarda céntimos, así que los 0,0024 € que sobran valen
  // 2,38 Bs— pero quien las lee no tiene cómo saberlo. De 13 abonos tecleados
  // en bolívares en dev, 7 discrepaban; la mayor diferencia, Bs. 3,48.
  //
  // Y LA RAZÓN DE FONDO PARA ELEGIR LO TECLEADO: es la cifra que el cliente
  // entregó y la única que el tendero puede defender delante de él. La
  // conversión describe lo que ese importe VALE, que es otra pregunta.
  //
  // LA CONVERSIÓN SIGUE AHÍ para el abono tecleado en divisa, donde es la
  // única forma de dar bolívares.
  const enBs =
    abono.entryCurrency === "VES" && abono.entryAmount != null
      ? abono.entryAmount
      : abono.tasaSellada != null
        ? abono.amount * abono.tasaSellada
        : null;

  const codigo = abono.transactionCode ?? null;

  // ── EL PIE CON EL CÓDIGO ────────────────────────────────────────────
  //
  // SE ENVUELVE LA TARJETA, NO SE COPIAN SUS CLASES. `CLASE_TARJETA` trae su
  // propio borde y su redondeo; con pie, el borde lo pone el envoltorio y la
  // tarjeta de dentro los suelta. Es el mismo patrón que la fila de «Así se
  // reparte el pago» en `abono-reparto.tsx`, y existe porque dos bordes
  // anidados se leen como dos tarjetas.
  //
  // SIN CÓDIGO NO HAY ENVOLTORIO y la tarjeta sale como siempre: `null` es
  // una fila anterior a la migración 147, y un pie que dijera «Código: —»
  // prometería algo que ninguna búsqueda va a encontrar.
  // LA TARJETA ENTERA ES EL ENLACE, no solo el chevron: es lo que el dueño
  // pidió para la del fiado («todo el card es clickeable») y aquí vale igual.
  const conEnlace = (cuerpo: React.ReactNode) =>
    href == null ? cuerpo : <Link href={href}>{cuerpo}</Link>;

  const conPie = (cuerpo: React.ReactNode) =>
    codigo == null ? (
      conEnlace(cuerpo)
    ) : (
      <div className="w-full overflow-hidden rounded-[10px] border [&>div:first-child]:rounded-none [&>div:first-child]:border-0 [&>a>div]:rounded-none [&>a>div]:border-0">
        {conEnlace(cuerpo)}
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            Código de transacción:{" "}
            <span className="font-medium text-primary tabular-nums">{codigo}</span>
          </span>
          {/* ALINEADO A LA DERECHA DEL PIE, pedido del dueño el 2026-10-23.
              Vive dentro del `<Link>` de la tarjeta, así que frena el evento
              — ver `BotonCopiarCodigo`. */}
          <BotonCopiarCodigo codigo={codigo} />
        </div>
      </div>
    );

  return conPie(
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
    // `bg-accent border-primary` SON LOS TOKENS DEL FRAME, no un gris
    // cualquiera: el mismo relleno que usa el resto de la app para «esto está
    // seleccionado», y un borde del color del texto, que es lo único que se
    // distingue sin depender del color.
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

        {/* ── EL RÓTULO VA AQUÍ, DEBAJO DEL CHIP ──────────────────────
            Corregido por el dueño el 2026-10-21: lo había puesto en la
            columna derecha, bajo la línea de bolívares. *«Debe ir alineado a
            la izquierda del card debajo del chip como te lo pasé en el
            frame»*.

            Y ASÍ LA TARJETA SE LEE EN DOS COLUMNAS LIMPIAS: a la izquierda
            cuándo y en qué estado quedó; a la derecha cuánto, en su moneda y
            en bolívares. A la derecha eran tres renglones apretados que
            partían la línea de bolívares en dos a 375px.

            `getBalanceLabel` elige entre «Debe», «A favor» y «Sin deuda»
            según el signo: un fiado saldado dirá «Sin deuda», que es la
            respuesta y no un cero suelto. Sin signo en la cifra, porque el
            rótulo ya lo lleva. */}
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
        </div>
      </div>
      </div>
      {/* EL «⋮» SUSTITUYE AL CHEVRON del frame viejo. Los dos vivían en el
          mismo sitio y los dos dicen «aquí hay más»; el chevron lo decía de la
          navegación, que ya la tiene el enlace de al lado, y el menú lo dice
          de las dos acciones que el dueño pidió el 2026-10-20. */}
      {/* EL CHEVRON SUSTITUYE AL «⋮» CUANDO LA TARJETA NAVEGA — frame
          `1510:9784`, nodo `1590:11449`. Los dos dicen «aquí hay más», pero
          uno de la ficha y el otro de un menú, y no pueden convivir. */}
      {href ? (
        <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      {href || inicial || !conAcciones ? null : (
      <AbonoAcciones
        movementId={abono.movementId}
        montoTecleado={abono.entryAmount ?? abono.amount}
        monedaTecleada={abono.entryCurrency ?? abono.currency}
        monedaDelLibro={abono.currency}
      />
      )}
    </div>,
  );
}
