"use client";

import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import type { EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { formatBs } from "@/lib/exchange-rate/format";
import { Fecha } from "@/components/fecha";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

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
  // `transactionCode` SE FUE EL 2026-10-24, y la razón la dio el dueño: *«el
  // usuario podrá verla al acceder al detalle del abono»*. Lo pidió el
  // 2026-10-23 y lo quitó al verlo en pantalla — seis filas seguidas, cada una
  // con su línea de código y su botón de copiar, convertían un índice en una
  // pared de texto.
  //
  // NO SE PIERDE NADA QUE SE PUEDA BUSCAR: el código sigue en la cabecera de
  // la ficha de cada abono (a donde lleva el chevron de esta fila), en la del
  // fiado, en las dos pantallas de éxito y en su PNG. Y el buscador del
  // historial sigue encontrándolo, porque busca sobre el dato y no sobre lo
  // que la fila dibuja.
  // Lo máximo que admite su fiado contando este abono, para el tope del
  // diálogo. `null` en un abono sin dirigir.
};

export function TarjetaDeAbono({
  abono,
  href = null,
  estado,
  inicial = false,
}: {
  abono: AbonoDirigido;
  // ── A DÓNDE LLEVA LA FILA ───────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-23: *«al seleccionar un abono de esa sección
  // redirigirá al detalle del abono»*. Con `href` la fila navega y dibuja su
  // chevron; sin él —la del abono de la compra, que no es un movimiento— sale
  // sin chevron y no se toca.
  href?: string | null;
  // EL ESTADO DEL PLAZO EN QUE ESE ABONO LLEGÓ, para su chip.
  estado?: EstadoDelPlazo;
  // LA FILA DE LA COMPRA: lo que se pagó al registrar el fiado. No es un
  // movimiento, así que no tiene ficha ni código, y su chip es el gris «Al día
  // de la compra» en vez de un estado del plazo.
  inicial?: boolean;
  // `pendienteTras` SE FUE EL 2026-10-24 con el rediseño de la sección: el
  // frame `1599:11697` no dibuja el renglón «Debe $X» en la fila, y esa cifra
  // se lee entera en «Total por cobrar» de la ficha. El porqué de que
  // existiera —se comprobaba restando dentro de la propia tarjeta— queda en
  // el historial de este archivo.
  // `conAcciones` SE FUE EL MISMO DÍA: la fila no lleva «⋮». Las acciones de
  // un abono viven en SU ficha, que es a donde lleva el chevron — y así la
  // vista del cliente no tiene que acordarse de apagarlas, porque no existen.
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

  // ═══════════════════════════════════════════════════════════════════════
  // YA NO ES UNA TARJETA: ES UNA FILA — frame `1599:11697`, 2026-10-24
  //
  // El dueño rediseñó la sección entera y las tarjetas con borde pasaron a
  // filas separadas por una línea. No es solo estética: desde que cada una
  // ABRE la ficha de su abono, la sección dejó de ser un escaparate de
  // tarjetas y pasó a ser un índice, y un índice se lee mejor en filas.
  //
  // LO QUE SE FUE CON EL RECUADRO: el renglón «Debe $X» —lo que quedaba del
  // fiado tras ese abono—, que el frame nuevo no dibuja. Esa cifra sigue
  // estando donde se puede leer entera, en «Total por cobrar» de la ficha.
  //
  // EL CHIP GRIS DE LA COMPRA NO ES UN `ChipDeEstado`: no es un estado del
  // plazo, es «esto se pagó el mismo día» — nodo `1510:9975`, gris y sin
  // borde. Los demás sí salen del plazo.
  const chip = inicial ? (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-transparent bg-accent px-1.5 py-px text-xs leading-4">
      Al día de la compra
    </span>
  ) : estado ? (
    <ChipDeEstado estado={estado} />
  ) : null;

  const cuerpo = (
    <div className="flex w-full items-center gap-3">
      {/* `min-w-0` EN LA COLUMNA QUE PUEDE CEDER, y `shrink-0` en la que no:
          a 375px lo que sobra es el nombre largo de una fecha, nunca la
          cifra. */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="text-sm"><Fecha iso={abono.fecha} /></span>
        {chip}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="flex items-center gap-1 text-sm tabular-nums text-money-in">
          +{formatPriceAmount(abono.amount, abono.currency ?? "COP")}
          {abono.currency ? (
            <CurrencyFlagIcon currency={abono.currency} className="size-4 shrink-0" />
          ) : null}
        </span>
        {enBs != null ? (
          // `text-right` Y NO SOLO `items-end`: con la línea partida en dos
          // —«Bs. 17.621,33 al día del abono»— la caja ocupa todo el ancho y
          // el texto se queda a la izquierda. Lo reportó el dueño el
          // 2026-10-21 con dos filas alineadas distinto según su número.
          <span className="text-right text-[10px] font-medium text-muted-foreground tabular-nums">
            {formatBs(enBs)} al día {inicial ? "de la compra" : "del abono"}
          </span>
        ) : null}
      </div>
      {href ? (
        <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </div>
  );

  // `flex-col gap-2` SE QUEDA aunque hoy la fila tenga un solo hijo: el
  // segundo renglón —el del código— vivió aquí un día entero y puede volver.
  return (
    <li className="flex flex-col gap-2 border-t py-4">
      {href ? (
        <Link href={href} className="block transition-colors active:bg-muted/60">
          {cuerpo}
        </Link>
      ) : (
        cuerpo
      )}
    </li>
  );
}
