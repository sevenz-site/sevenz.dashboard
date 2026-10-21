"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import Link from "next/link";
import {
  MovementTypeFilter,
  type TipoFiltro,
} from "@/components/dashboard/movement-type-filter";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatDate, truncateText } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
import type { Movement } from "@/lib/types";
import type { VentaDeContado } from "@/lib/ventas-de-contado";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import type { EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { EmptyState } from "@/components/dashboard/empty-state";

const PAGE_SIZE = 10;


// EL FILTRO POR TIPO, pedido por el dueño el 2026-10-16: "Todos", "Fiado" y
// "Abono", a la derecha del rótulo "Historial".
//
// EL RÓTULO ENTRA COMO PROP y no se escribe aquí. Las dos pantallas que usan
// esta lista lo titulan distinto y con tipografías distintas —"Historial de
// movimientos" en 20px en la ficha del tendero, "Historial" en 14px gris en
// la del cliente—, así que el componente coloca el chip a su derecha sin
// decidir cómo se ve el título.
//
// EL CHIP VIVE AQUÍ Y NO EN LA PÁGINA porque el estado es suyo: la lista es
// la que filtra y la que pagina, y las dos cosas tienen que moverse juntas.
// Un chip en la página sería otra vez dos hermanos compartiendo estado.


// ESTA LISTA YA NO SABE NADA DE LA FICHA DE UN MOVIMIENTO.
//
// Hasta el 2026-10-19 montaba un diálogo por fila y tenía que recibir todo lo
// que ese diálogo necesitaba: las fotos firmadas, las tasas, el pendiente por
// fiado, con qué compartir. El detalle pasó a ser una pantalla con dirección
// propia (`/transacciones/[id]`), así que cada fila es un enlace y esos datos
// los carga la página de destino, que es la única que los usa.
export function MovementHistoryList({
  movements,
  ledger = null,
  titulo = null,
  ventasDeContado = [],
  estadosDeFiado = {},
  pendientePorFiado = {},
}: {
  movements: Movement[];
  // null = plain COP ledger.
  ledger?: LedgerDisplay | null;
  // El rótulo de la sección, para poder poner el filtro a su derecha. Ver el
  // comentario de `FiltroDeTipo`.
  titulo?: React.ReactNode;
  // LAS VENTAS PAGADAS ENTERAS, que no son movimientos y por eso llegan
  // aparte. Ver `lib/ventas-de-contado.ts`: una venta pagada no escribe nada
  // en `movements`, así que el historial las MEZCLA al pintar en vez de
  // convertirlas en filas de esa tabla -- el saldo, el puntaje de crédito y
  // las gráficas siguen leyendo solo `movements` y no se enteran.
  ventasDeContado?: VentaDeContado[];
  // EL ESTADO DEL PLAZO DE CADA FIADO, indexado por el id de su movimiento.
  // Lo calcula la página, que es quien tiene lo que cada fiado todavía debe.
  // Un fiado que falte aquí —o que valga `null`— no dibuja chip: es el caso
  // de casi todo lo que entró por la libreta, que no trae plazo.
  estadosDeFiado?: Record<string, EstadoDelPlazo | null>;
  // LO QUE CADA FIADO TODAVÍA DEBE, por el id de su movimiento. Misma fuente
  // que `estadosDeFiado` -- `get_open_charges_for_client` -- y por eso llegan
  // juntos. Un fiado que falte aquí está saldado.
  pendientePorFiado?: Record<string, number>;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  // ── LAS DOS CLASES DE FILA, EN UNA SOLA LISTA ─────────────────────
  //
  // Un movimiento y una venta de contado no comparten tabla ni forma, así que
  // se juntan aquí con una marca y se ordenan por fecha. La alternativa
  // --dos listas, una debajo de otra-- rompería lo único que el tendero busca
  // en esta pantalla: qué pasó, en orden.
  // ── LOS ABONOS NO SALEN AQUÍ. NINGUNO ────────────────────────────────
  //
  // Decisión del dueño el 2026-10-20, y la eligió con el coste delante:
  // *«como el fiado se lleva sobre una misma cuenta, agregar los movimientos
  // de abonos por separados en el historial sería redundante, esos abonos
  // deberían aparecer solo sobre el movimiento del detalle del fiado, es
  // decir viven solo ahí, no se ven en el historial»*.
  //
  // LO QUE ESTO SE LLEVA, DICHO EN VOZ ALTA: un abono solo se ve dentro del
  // fiado al que fue dirigido, y en dev **104 de 108 abonos no van dirigidos
  // a ninguno** -- son anteriores a la migración `126` y la cola FIFO los
  // repartió sin dejar constancia de a qué cargo. Esos abonos dejan de tener
  // sitio donde verse. Está anotado como `CT-115`, con la alternativa que se
  // descartó.
  //
  // SE FILTRA AQUÍ Y NO EN LA CONSULTA a propósito: `movements` sigue
  // llegando entero porque la fila de un fiado necesita su `running_balance`,
  // que se calcula contra todos los movimientos. Pedir menos a la base
  // ahorraría nada y rompería esa columna.
  const filas: Fila[] = [
    ...movements
      .filter((m) => m.type !== "payment")
      .map((m): Fila => ({ clase: "movimiento", fecha: m.created_at, m })),
    ...ventasDeContado.map((v): Fila => ({ clase: "contado", fecha: v.createdAt, v })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const visibles =
    tipo === "todos"
      ? filas
      : filas.filter((f) =>
          tipo === "cash" ? f.clase === "contado" : f.clase === "movimiento" && f.m.type === tipo,
        );

  // LA PÁGINA VUELVE A LA 1 AL CAMBIAR DE FILTRO, y esto no es cosmético.
  // Sin ello, quien esté en la página 3 de «Todas» y toque «De contado» ve una
  // lista vacía con el paginador diciendo «Página 1 de 1» -- porque `safePage`
  // la acota al pintar pero `page` sigue valiendo 3, así que al volver a
  // «Todas» salta a la 3 sin que nadie lo haya pedido. Es el mismo estado
  // sirviendo a dos preguntas distintas.
  //
  // SE HACE EN EL SETTER Y NO EN UN EFECTO. La primera versión fue un
  // `useEffect(..., [tipo])` y `eslint` lo rechazó con
  // `react-hooks/set-state-in-effect` -- con razón: pinta la página vieja,
  // luego la corrige, y son dos renders donde cabe uno.
  //
  // Y era además el fallo que `PL-4` describe entrando por la puerta que esa
  // ficha avisa: el lint lleva en rojo desde el 2026-09-20 por otra cosa, así
  // que un error nuevo se habría leído como «ya, es PL-4».
  //
  // El filtro es lo único que cambia `tipo`, así que las dos cosas se mueven
  // juntas aquí y no hay estado que sincronizar.
  function cambiarTipo(t: TipoFiltro) {
    setTipo(t);
    setPage(1);
  }

  // LA CABECERA SE PINTA SIEMPRE, incluso sin un solo movimiento. Si
  // desapareciera con la lista, un filtro que no deja nada se llevaría por
  // delante el único control que sirve para deshacerlo.
  const cabecera = titulo ? (
    <div className="flex items-center justify-between gap-3">
      {titulo}
      {filas.length > 0 ? (
        <MovementTypeFilter tipo={tipo} setTipo={cambiarTipo} conAbono={false} conContado={ventasDeContado.length > 0} />
      ) : null}
    </div>
  ) : null;

  // `filas` Y NO `movements.length`: un cliente cuyo único historial son
  // abonos ya no tiene nada que enseñar aquí, y contar los movimientos en
  // bruto le pintaría una lista vacía con cabecera en vez del hueco dibujado.
  if (filas.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        {/* EL HUECO SE DIBUJA, no se deja en blanco. Del mock del dueño del
            2026-10-18: una caja con la frase centrada y, debajo, qué hacer
            para llenarla. Un «Todavía no hay…» suelto a la izquierda se lee
            como un error de carga; esto se lee como una pantalla nueva.

            LOS DOS BOTONES QUE CITA SON LOS QUE ESTÁN JUSTO ENCIMA, y por eso
            se nombran con sus palabras exactas. El día que uno se renombre
            —«Agregar fiado» pasó a «Venta o fiado» ese mismo día— esta frase
            hay que cambiarla con él, o manda a buscar algo que no existe. */}
        <EmptyState
          title="Todavía no hay transacciones registradas"
          subtitle="Para registrar una transacción selecciona “Agregar abono” o “Venta o fiado”"
        />
      </div>
    );
  }

  // "No hay de ese tipo" no es "no hay ninguno", y la segunda frase sería
  // falsa con la lista entera a un toque de distancia.
  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <EmptyState
          title={`Este cliente no tiene ${tipo === "charge" ? "fiados" : "ventas de contado"} registrados`}
        />
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagina = visibles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {cabecera}
      <ul className="flex flex-col divide-y rounded-lg border">
        {pagina.map((fila) => {
          if (fila.clase === "contado") {
            return <FilaDeContado key={`venta-${fila.v.saleId}-${fila.v.currency ?? "cop"}`} venta={fila.v} ledger={ledger} />;
          }
          const m = fila.m;
          const amount = formatLedgerAmount(m.amount, m.currency, ledger);
          // Si el movimiento se escribió en bolívares, la línea de abajo dice
          // ESOS bolívares y no lo que vale hoy la deuda.
          //
          // Tenía el cálculo de hoy, y era defendible: esa columna responde
          // "cuánto vale ahora" en todas las filas por igual. Pero el dueño
          // tecleó 900 y leía 899,09 — los 91 céntimos del redondeo, correctos
          // y sin explicación a la vista. La consistencia que yo protegía era
          // de cómo se calcula el número, no de lo que significa, y para quien
          // mira la lista lo segundo pesa mas.
          const bsTecleados =
            m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : null;
          // ── «POR COBRAR» ES LO QUE ESTE FIADO DEBE, NO EL SALDO DEL
          //    CLIENTE ─────────────────────────────────────────────────
          //
          // Llevaba `m.running_balance`: cuánto debía el cliente entero justo
          // DESPUÉS de este movimiento, como el saldo de un extracto bancario.
          // Eso se sostenía mientras los abonos se veían — se leían las filas
          // hacia abajo y la cifra bajaba delante de los ojos.
          //
          // AL ESCONDER LOS ABONOS el 2026-10-20 dejó de sostenerse, y se vio
          // en pantalla con un cliente de dev: la fila de arriba decía «Por
          // cobrar $89.72» mientras la tarjeta de ese mismo cliente decía
          // $68.59, y los 21 dólares de diferencia eran los dos abonos que
          // acababan de desaparecer. Nada en la pantalla explicaba el hueco.
          //
          // El peor caso es el que importa: el tendero lee la fila de arriba,
          // le cobra 89,72 a alguien que debe 68,59, y la app le dio las dos
          // cifras sin decir cuál valía.
          //
          // Ahora dice lo que ESE fiado debe, que es la misma cifra que su
          // propia ficha pone en «Total por cobrar» desde el 2026-10-19 — y la
          // cambió ese día por esta misma razón, encontrada del mismo modo.
          const pendienteDeEsteFiado =
            m.type === "charge" ? (pendientePorFiado[m.id] ?? 0) : null;
          const balance = formatLedgerAmount(pendienteDeEsteFiado ?? 0, m.currency, ledger);
          // Solo los fiados llevan chip. Un abono no llega hasta aquí, y una
          // venta de contado no tiene plazo que cumplir.
          const estado = m.type === "charge" ? (estadosDeFiado[m.id] ?? null) : null;

          return (
          <li key={m.id}>
            <Link
              href={`/transacciones/${m.id}`}
              className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {truncateText(
                      `${m.type === "charge" ? "Fiado" : "Abono"}${m.description ? ` · ${m.description}` : ""}`,
                      34,
                    )}
                  </p>
                  {/* LA FECHA Y EL ESTADO DEL PLAZO, en la misma línea.
                      Pedido por el dueño el 2026-10-20: *«un fiado en el
                      historial debería mostrar el estado del plazo de ese
                      fiado»*.

                      `flex-wrap` porque la fecha larga de un negocio
                      colombiano más el chip no caben en 375px, y lo que NO
                      puede partirse es el chip -- eso lo garantiza él mismo
                      con su `whitespace-nowrap`, por lo que costó el 2026-10-20
                      en la tabla de cuotas. */}
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {formatDate(m.created_at)}
                      {m.source === "photo_import" ? " · de libreta" : ""}
                    </span>
                    {estado ? <ChipDeEstado estado={estado} /> : null}
                  </p>
                  {/* LA BANDERA EN LAS DOS CIFRAS DE LA FILA, desde el
                      2026-10-16, por instrucción del dueño. Esta lista es
                      donde más falta hacía: en una cartera venezolana las
                      filas en dólares y en euros se alternan, y lo único que
                      las distinguía era el símbolo — "$" y "€" pegados a un
                      número, que es justo el par que se confunde de un
                      vistazo.

                      Solo cuando la moneda existe. `null` es un negocio
                      colombiano, donde no hay dos libros que separar y una
                      bandera repetida en cada fila sería ruido. */}
                  {/* Un fiado saldado no dice «Por cobrar $0.00»: ya lo dice
                      su chip «Pagado», y la cifra en cero al lado se lee como
                      un dato que falta. */}
                  {pendienteDeEsteFiado != null && pendienteDeEsteFiado > 0.005 ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {m.currency ? <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" /> : null}
                      Por cobrar {balance.primary}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className={`flex flex-col items-end tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-blue-600 dark:text-blue-400"}`}
                  >
                    <span className="flex items-center gap-1">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                      ) : null}
                      {m.type === "charge" ? "+" : "-"}
                      {amount.primary}
                    </span>
                    {bsTecleados ?? amount.secondary ? (
                      <span className="font-normal text-muted-foreground">
                        {bsTecleados ?? amount.secondary}
                      </span>
                    ) : null}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
            </Link>

          </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text="Anterior"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage > 1) setPage(safePage - 1);
                }}
                className={safePage <= 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm text-muted-foreground">
                Página {safePage} de {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                text="Siguiente"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage < pageCount) setPage(safePage + 1);
                }}
                className={safePage >= pageCount ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}

// Una fila del historial: o un movimiento, o una venta pagada entera.
type Fila =
  | { clase: "movimiento"; fecha: string; m: Movement }
  | { clase: "contado"; fecha: string; v: VentaDeContado };

// UNA VENTA DE CONTADO EN EL HISTORIAL.
//
// ===========================================================================
// VERDE, Y NO ES EL VERDE QUE HABÍA
//
// Decisión del dueño el 2026-10-18: el contado va en VERDE y el abono pasa a
// AZUL. Hasta ese día el verde era del abono.
//
// Lo que distingue a las tres filas, y conviene tenerlo escrito porque los
// colores solos no lo dicen: el fiado (rojo, «+») SUBE la deuda, el abono
// (azul, «−») la BAJA, y el contado (verde, sin signo) NO LA TOCA. Por eso no
// lleva signo: un «+» o un «−» prometerían un movimiento del saldo que no
// ocurre.
//
// ===========================================================================
// YA SE ABRE. Aquí decía «no se abre, todavía»
//
// Hasta el 2026-10-19 esta fila era de solo lectura, porque el detalle estaba
// escrito sobre un movimiento --su id, su saldo acumulado, su comprobante, su
// plazo-- y una venta pagada no tiene ninguna de esas cosas. Desde el
// 2026-10-20 tiene su propia pantalla, `/transacciones/venta/<venta>/<moneda>`,
// y la dirección lleva LA MONEDA porque una venta mixta tiene una pantalla por
// libro: entrar por la fila de dólares no puede enseñar los euros.
//
// `cop` ES EL SEGMENTO DEL LIBRO NULO, no una moneda de verdad. La pantalla lo
// traduce de vuelta con su propio mapa; aquí se escribe igual para que las dos
// puntas del enlace no se separen.
function FilaDeContado({ venta, ledger }: { venta: VentaDeContado; ledger: LedgerDisplay | null }) {
  const amount = formatLedgerAmount(venta.amount, venta.currency, ledger);
  // Qué se llevó, en una línea. Es lo que la fila de un fiado pone después de
  // «Fiado · », y aquí es lo único que identifica la compra.
  const que = venta.lineas.map((l) => l.name).join(", ");

  return (
    <li>
      <Link
        href={`/transacciones/venta/${venta.saleId}/${(venta.currency ?? "cop").toLowerCase()}`}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {truncateText(`De contado${que ? ` · ${que}` : ""}`, 34)}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(venta.createdAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* `emerald-700` Y NO `emerald-600`, que es el verde que usaba el
              abono hasta hoy: medido contra blanco da 3,67:1 y el piso de
              `DESIGN-SYSTEM.md` son 4,5:1. El 700 da 5,37:1.

              O sea que el verde del abono llevaba fallando el contraste desde
              siempre, y el cambio a azul lo arregla de rebote -- `blue-600`
              da 5,26:1. No se heredó aquí el fallo por parecerse al de antes. */}
          <div className="flex flex-col items-end tabular-nums text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <span className="flex items-center gap-1">
              {venta.currency ? (
                <CurrencyFlagIcon currency={venta.currency} className="size-3.5 shrink-0" />
              ) : null}
              {amount.primary}
            </span>
            {amount.secondary ? (
              <span className="font-normal text-muted-foreground">{amount.secondary}</span>
            ) : null}
          </div>
          {/* EL CHEVRON DE VERDAD, no el hueco que había. Mientras la fila no
              se abría, aquí iba un `<span>` vacío del mismo tamaño para que
              los importes quedaran en la misma columna que los de las otras
              filas. Ahora lleva a su pantalla como las demás, así que lleva
              la misma flecha. */}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>
    </li>
  );
}
