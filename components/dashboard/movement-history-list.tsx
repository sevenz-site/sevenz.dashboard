"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
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
  pendientePorFiado = {},
  navegable = true,
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
  // AQUÍ ESTUVO `estadosDeFiado`, el chip «Dentro del plazo» / «Plazo
  // vencido» de cada fiado. Lo pidió el dueño el 2026-10-20 y lo quitó el
  // 2026-10-21, al reescribir esta fila contra el frame `1512:10061`, que no
  // lo dibuja. El chip sigue vivo donde el frame sí lo pone: en la tabla de
  // cuotas y en las tarjetas de abono dentro de un fiado.
  // LO QUE CADA FIADO TODAVÍA DEBE, por el id de su movimiento. Misma fuente
  // que `estadosDeFiado` -- `get_open_charges_for_client` -- y por eso llegan
  // juntos. Un fiado que falte aquí está saldado.
  pendientePorFiado?: Record<string, number>;
  // ── ¿SE PUEDE TOCAR UNA FILA? ────────────────────────────────────────
  //
  // `false` en la hoja «Cuenta de <cliente>» que sale cuando una cédula ya
  // existe, por instrucción del dueño el 2026-10-21: *«el botón ">" no debe
  // aparecer y la card no debe ser clickeable»*.
  //
  // Y tiene razón de fondo, no solo de aspecto: esa hoja aparece en mitad de
  // una venta que vive EN MEMORIA. Tocar una fila navegaba a
  // `/transacciones/<id>` y tiraba la venta entera — el carrito, el cliente a
  // medio escribir y el pago. La hoja está ahí para mirar y decidir, no para
  // irse a otro sitio.
  //
  // El chevron se va con el enlace: decía «aquí se puede entrar», y ya no.
  navegable?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  // ── LAS DOS CLASES DE FILA, EN UNA SOLA LISTA ─────────────────────
  //
  // Un movimiento y una venta de contado no comparten tabla ni forma, así que
  // se juntan aquí con una marca y se ordenan por fecha. La alternativa
  // --dos listas, una debajo de otra-- rompería lo único que el tendero busca
  // en esta pantalla: qué pasó, en orden.
  // ── LOS ABONOS SÍ SALEN AQUÍ, TODOS ──────────────────────────────────
  //
  // Encargo del dueño el 2026-10-22: *«ver los abonos solo dentro del fiado es
  // engorroso, agreguemos los abonos también en el historial de transacciones
  // (el abono se mantiene también en el detalle del fiado) y al abrirlo abre
  // el fiado a donde fue agregado»*.
  //
  // ESTO REVIERTE SU PROPIA DECISIÓN DEL 2026-10-20, y las dos quedan escritas
  // porque la vieja explica por qué el código estuvo así dos días. Entonces
  // dijo: *«como el fiado se lleva sobre una misma cuenta, agregar los
  // movimientos de abonos por separados en el historial sería redundante»*.
  // Lo que cambió no es el argumento —sigue siendo redundante— sino cuál de
  // los dos costes pesa más: la redundancia molesta menos que tener que entrar
  // a un fiado para enterarte de que alguien te pagó.
  //
  // De aquel día sobrevive lo que se aprendió por el camino: un abono SIN
  // dirigir --la cola FIFO lo repartió sin dejar constancia de a cuál-- no
  // tiene ningún fiado donde verse, así que esconderlos todos lo borraba de la
  // app entera. Fueron 104 de 115. Ahora salen todos y ese caso desaparece
  // solo.
  //
  // ── LA FECHA DE UN FIADO VUELVE A SER LA SUYA ────────────────────────
  //
  // El 2026-10-21 la fila de un fiado enseñaba la fecha de su ÚLTIMO ABONO
  // --*«fecha de último abono (en caso de fiado)»*--, y tenía sentido mientras
  // los abonos no salían: era la única forma de saber que algo había pasado.
  //
  // CON EL ABONO EN SU PROPIA FILA ESO SE VUELVE EN CONTRA, y además era un
  // desorden visible: la lista se ORDENABA por `created_at` y ENSEÑABA otra
  // fecha, así que un fiado de agosto abonado ayer decía «ayer» sentado en
  // agosto. Es lo que el dueño reportó el 2026-10-22 pidiendo que el historial
  // vaya *«del más reciente al más antiguo»*.
  //
  // Decidido por él ese día, entre las dos opciones: cada fila por su propia
  // fecha. Así lo que se ordena y lo que se lee son la misma cifra, que es la
  // única forma de que «ordenado por fecha» signifique algo.
  // Para encontrar el fiado que pagó un abono sin recorrer la lista en cada
  // fila. Con doscientos movimientos la diferencia no se nota; el mapa está
  // porque la alternativa es un `find` dentro de un `map`, que es la forma de
  // que un día sí se note.
  const porId = new Map(movements.map((m) => [m.id, m]));

  const filas: Fila[] = [
    ...movements.map((m): Fila => ({ clase: "movimiento", fecha: m.created_at, m })),
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
        <MovementTypeFilter
          tipo={tipo}
          setTipo={cambiarTipo}
          // «Abono» VUELVE AL FILTRO, PERO SOLO SI HAY ALGUNO QUE FILTRAR.
          // Desde el 2026-10-21 la lista enseña los abonos sin dirigir, y un
          // filtro tiene que poder nombrar lo que se ve. Al revés también: en
          // un cliente cuyos abonos estén todos dirigidos, ofrecer «Abono»
          // daría una lista vacía por un filtro que no podía dar otra cosa.
          conAbono={filas.some((f) => f.clase === "movimiento" && f.m.type === "payment")}
          conContado={ventasDeContado.length > 0}
        />
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
            return <FilaDeContado key={`venta-${fila.v.saleId}-${fila.v.currency ?? "cop"}`} venta={fila.v} ledger={ledger} navegable={navegable} />;
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
          // ═══════════════════════════════════════════════════════════════
          // «POR COBRAR» SIGNIFICA LO MISMO EN LAS DOS FILAS
          //
          // Frames `1548:11075` (fiado) y `1548:11049` (abono), del
          // 2026-10-22: *«Ajustemos las cards para hacerlas consistentes
          // entre los diferentes tipos de transacciones»*.
          //
          // QUÉ MEDÍA ANTES, Y POR QUÉ NO SE SOSTENÍA. En un fiado era lo que
          // ESE fiado debe; en un abono, el saldo del cliente entero justo
          // después de ese pago. Dos cosas distintas bajo un rótulo idéntico,
          // y se veía: en la ficha de un abono de dev salía «Debe $23.23» en
          // la tarjeta del fiado y «Total por cobrar $68.59» cuatro líneas más
          // abajo, sin nada que dijera que no eran comparables.
          //
          // AHORA LAS DOS MIRAN AL MISMO FIADO: el propio si la fila es un
          // fiado, y el que pagó si es un abono. Es la única lectura bajo la
          // que «consistentes» quiere decir algo, y encaja con que desde hoy
          // la fila de un abono ABRE ese fiado.
          //
          // UN ABONO SIN DIRIGIR SE QUEDA SIN ESTE RENGLÓN, y es correcto: la
          // cola FIFO lo repartió sin dejar constancia de a cuál, así que no
          // hay ningún fiado del que informar. Son todos anteriores al
          // 2026-10-14.
          const fiadoDeLaFila =
            m.type === "charge" ? m : (porId.get(m.applies_to_movement_id ?? "") ?? null);
          const pendienteDelFiado =
            fiadoDeLaFila == null ? null : (pendientePorFiado[fiadoDeLaFila.id] ?? 0);
          const porCobrar =
            pendienteDelFiado == null
              ? null
              : formatLedgerAmount(pendienteDelFiado, m.currency, ledger);

          // ── EL IMPORTE DE ARRIBA ES EL DE LA TRANSACCIÓN ──────────────
          //
          // En un fiado era el PENDIENTE desde el 2026-10-21 --«saldo total
          // por cobrar de ese fiado», sus palabras-- porque la fila solo tenía
          // sitio para un número y ese era el que faltaba. Con el segundo piso
          // caben los dos, así que arriba vuelve lo que se fió y abajo va lo
          // que queda. No se pierde nada y se recupera lo que esa decisión
          // había tapado: cuánto se prestó en realidad.
          //
          // LA LÍNEA GRIS DE ARRIBA DICE DE CUÁNDO ES SU CIFRA. Un abono
          // tecleado en bolívares enseña ESOS bolívares, que son los de aquel
          // día; sin ellos cae en la conversión de hoy, y entonces lo dice.
          const bsDeArriba = bsTecleados ?? amount.secondary;
          const cuandoEsEsaCifra = bsTecleados ? "Al día del abono" : "hoy";
          // El mismo reparto para las dos clases de fila: con `navegable` es
          // un enlace; sin él, un `div` con las mismas clases menos el
          // `hover`, que prometería algo que no pasa.
          return (
          <li key={m.id}>
            {/* UN ABONO ABRE EL FIADO AL QUE FUE, no su propia ficha. Encargo
                del dueño el 2026-10-22: *«al abrirlo abre el fiado a donde fue
                agregado»*. Desde ahí se llega a la ficha del abono tocando su
                tarjeta, que es donde él decidió el 2026-10-19 que vivieran.

                `?? m.id` NO SOBRA: un abono sin dirigir no tiene fiado que
                abrir --la cola FIFO lo repartió sin dejar constancia de a
                cuál-- así que cae en su propia ficha, que es lo único que
                tiene. Son todos anteriores al 2026-10-14. */}
            <FilaEnvuelta
              columna
              href={navegable ? `/transacciones/${m.applies_to_movement_id ?? m.id}` : null}
            >
              {/* ── PISO 1: QUÉ FUE, CUÁNDO Y POR CUÁNTO ──────────────── */}
              <div className="flex w-full items-center justify-between gap-3">
                {/* ── LA IZQUIERDA: QUÉ FUE Y CUÁNDO, Y NADA MÁS ──────
                    Frame `1512:10061`, reescrita el 2026-10-21 con la
                    instrucción del dueño delante: *«del lado izquierdo de la
                    card estará solo el tipo de transacción + producto +
                    fecha»*.

                    SE VAN DE AQUÍ TRES COSAS que el frame no dibuja: el chip
                    del estado del plazo, la línea «Por cobrar» —que pasa a la
                    derecha, donde el frame la pone— y el sufijo «· de
                    libreta». */}
                {/* `shrink-0 whitespace-nowrap`, COMO EL FRAME `1512:10061`: su
                    columna izquierda no se encoge y la derecha es la que cede.
                    Era al revés —`min-w-0` aquí— y con la línea «Bs. … Al día
                    de compra», que es mucho más larga que los bolívares
                    sueltos de antes, el nombre salía «De conta…» y la fecha
                    caía en tres renglones. Lo que puede partirse sin perder
                    nada es la cifra de la derecha; el qué y el cuándo, no. */}
                <div className="shrink-0 whitespace-nowrap">
                  {/* «Abono · Lapicero», CON EL NOMBRE DEL FIADO QUE PAGÓ —
                      frame `1548:11049`. Un abono no tiene producto propio: lo
                      hereda del fiado, que es el mismo que la fila abre al
                      tocarla. Sin fiado a la vista cae en su propia
                      descripción, y si tampoco la hay se queda en «Abono». */}
                  <p className="truncate text-sm font-medium">
                    {truncateText(
                      `${m.type === "charge" ? "Fiado" : "Abono"}${
                        (fiadoDeLaFila?.description ?? m.description)
                          ? ` · ${fiadoDeLaFila?.description ?? m.description}`
                          : ""
                      }`,
                      34,
                    )}
                  </p>
                  {/* SU PROPIA FECHA, que es también la que ordena la lista.
                      Ver arriba por qué dejó de ser la del último abono. */}
                  <p className="text-xs text-muted-foreground">{formatDate(m.created_at)}</p>
                  {/* UN FIADO PAGADO LLEVA SU CHIP «Pagado». Instrucción del
                      dueño el 2026-10-21, contestando a la regresión que dejó
                      a un fiado saldado anunciando «Por cobrar +$0.00»:
                      *«debe tener estado "Pagado" como se definió en el chip y
                      saldo por cobrar = 0»*.

                      SOLO ESE ESTADO, y es deliberado: el frame `1512:10061`
                      no dibuja chip ninguno, y los de «Dentro del plazo» y
                      «Plazo vencido» se retiraron de esta fila ese mismo día
                      por eso. Pero el frame tampoco dibuja un fiado saldado —
                      su ejemplo tiene deuda— así que no dice nada sobre este
                      caso. El cero solo, sin nada que lo explique, se lee como
                      un dato que falta; con el chip al lado se lee como la
                      respuesta que es. */}
                  {m.type === "charge" && (pendienteDelFiado ?? 0) <= 0.005 ? <ChipDeEstado estado="pagado" /> : null}

                  {/* AQUÍ ESTUVO EL «Por cobrar» DEL ABONO, en texto pequeño
                      y pegado bajo la fecha. Baja al piso 2, que los frames
                      `1548:11049` y `1548:11075` dan por igual a los dos
                      tipos. */}
                </div>
                {/* ── LA DERECHA DEL PISO 1: EL IMPORTE DE LA TRANSACCIÓN ──
                    Frames `1548:11075` y `1548:11049`: bandera, importe, y
                    debajo sus bolívares. Rojo en un fiado, verde en un abono.

                    EL SIGNO SE QUEDA COMO ESTABA --`+` al fiar, `-` al
                    abonar--, y eso es una DECISIÓN DEL DUEÑO del 2026-10-22,
                    no un olvido. Los dos frames escriben `+$00.00`, también el
                    del abono, y se le preguntó enseñando las dos lecturas: el
                    `+` del frame se lee como «entraron 20 dólares a la caja»,
                    que es cierto, pero en una lista donde el fiado TAMBIÉN
                    lleva `+` el signo deja de distinguir nada y todo el peso
                    cae en el color --invisible en una captura en gris, y para
                    quien no separa el rojo del verde--. Eligió el `-`. */}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                  <div
                    className={`flex min-w-0 flex-col items-end text-right tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    <span className="flex items-center gap-1">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                      ) : null}
                      {m.type === "charge" ? "+" : "-"}
                      {amount.primary}
                    </span>
                    {bsDeArriba ? (
                      <span className="font-normal text-muted-foreground">
                        {bsDeArriba} {cuandoEsEsaCifra}
                      </span>
                    ) : null}
                  </div>
                  {navegable ? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                </div>
              </div>

              {/* ── PISO 2: «POR COBRAR» ──────────────────────────────────
                  Frames `1548:11075` y `1548:11049`, que se lo dan IGUAL a
                  los dos tipos: rótulo a la izquierda, y a la derecha la
                  bandera, la cifra en 16 semibold y los bolívares de hoy.
                  Separado por una línea, que es lo que lo distingue del
                  importe de arriba.

                  «hoy» Y NO LA TASA SELLADA: esto es una deuda VIVA, así que
                  la pregunta es cuánto vale ahora. El importe de arriba es
                  histórico y por eso el suyo dice de cuándo es. */}
              {porCobrar ? (
                <div className="flex w-full items-start justify-between gap-3 border-t pt-2">
                  <span className="text-sm text-muted-foreground">Por cobrar</span>
                  <span className="flex flex-col items-end gap-0.5 text-right tabular-nums">
                    <span className="flex items-center gap-1 text-base font-semibold">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-4 shrink-0" />
                      ) : null}
                      {porCobrar.primary}
                    </span>
                    {porCobrar.secondary ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {porCobrar.secondary} hoy
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </FilaEnvuelta>

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
// LA FILA ES UN ENLACE O NO LO ES, y esto lo decide en un sitio.
//
// Un `const Fila = navegable ? Link : "div"` parecía más corto y TypeScript lo
// rechaza con razón: `Link` exige `href` y un `div` no lo admite, así que la
// unión de las dos props no es asignable a ninguno de los dos. Esto lo
// resuelve donde se sabe la respuesta.
//
// EL `hover` VIAJA CON EL ENLACE. Un fondo que cambia al pasar por encima es
// una promesa de que algo va a pasar al tocar; sin enlace, es mentira.
function FilaEnvuelta({
  href,
  children,
  // DOS PISOS, para la fila de un movimiento — frames `1548:11075` y
  // `1548:11049`. La de contado NO lo lleva y por eso esto es una bandera y
  // no el único reparto: una venta pagada entera no tiene nada «por cobrar»
  // que poner debajo, y los frames del 2026-10-22 no la dibujan.
  columna = false,
}: {
  href: string | null;
  children: React.ReactNode;
  columna?: boolean;
}) {
  const base = columna
    ? "flex w-full flex-col gap-1.5 p-3 text-left"
    : "flex w-full items-center justify-between gap-3 p-3 text-left";
  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={href}
      className={`${base} hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset`}
    >
      {children}
    </Link>
  );
}

function FilaDeContado({
  venta,
  ledger,
  navegable,
}: {
  venta: VentaDeContado;
  ledger: LedgerDisplay | null;
  navegable: boolean;
}) {
  const amount = formatLedgerAmount(venta.amount, venta.currency, ledger);
  // Qué se llevó, en una línea. Es lo que la fila de un fiado pone después de
  // «Fiado · », y aquí es lo único que identifica la compra.
  const que = venta.lineas.map((l) => l.name).join(", ");

  // LOS BOLÍVARES SELLADOS, NO LOS DE HOY — frame `1512:10061`, que escribe
  // «Bs. … Al día de compra». Esa venta se pagó entera en su día, así que su
  // equivalencia es la de aquel día: decir lo que «son» hoy describe una
  // conversión que nadie hizo. Es la misma regla que ya rige la tarjeta de un
  // abono dentro de su fiado.
  //
  // Sin tasa sellada no se dibuja la línea. Un negocio colombiano no tiene
  // ninguna, y lo anterior al sellado tampoco: inventar una es peor que
  // callar.
  const enBsSellados =
    venta.tasaSellada == null ? null : formatBs(venta.amount * Number(venta.tasaSellada));


  return (
    <li>
      <FilaEnvuelta
        href={
          navegable
            ? `/transacciones/venta/${venta.saleId}/${(venta.currency ?? "cop").toLowerCase()}`
            : null
        }
      >
        <div className="shrink-0 whitespace-nowrap">
          <p className="truncate text-sm font-medium">
            {truncateText(`De contado${que ? ` · ${que}` : ""}`, 34)}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(venta.createdAt)}</p>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {/* `emerald-700` AND NOT `emerald-600`: measured against white the
              600 gives 3,65:1 and the floor in `DESIGN-SYSTEM.md` is 4,5:1.
              The 700 gives 5,36:1.

              THAT NUMBER IS WHY THIS ROW AND THE ABONO SHARE A GREEN TODAY.
              `emerald-600` was the abono's green until 2026-10-18 and had been
              failing contrast the whole time without anyone noticing. When the
              owner asked for the abono's green back on 2026-10-21, restoring
              it literally would have brought the defect back; it went to this
              700 instead, which is why the two rows now match.

              AND THEY ARE MEANT TO MATCH, which the owner decided when asked:
              a cash sale and an abono are both money coming IN, against the
              fiado's red. What tells them apart is the label, not the hue. */}
          <div className="flex min-w-0 flex-col items-end text-right tabular-nums text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <span className="flex items-center gap-1">
              {venta.currency ? (
                <CurrencyFlagIcon currency={venta.currency} className="size-3.5 shrink-0" />
              ) : null}
              {amount.primary}
            </span>
            {enBsSellados ? (
              <span className="font-normal text-muted-foreground">
                {enBsSellados} Al día de compra
              </span>
            ) : null}
          </div>
          {/* EL CHEVRON DE VERDAD, no el hueco que había. Mientras la fila no
              se abría, aquí iba un `<span>` vacío del mismo tamaño para que
              los importes quedaran en la misma columna que los de las otras
              filas. Ahora lleva a su pantalla como las demás, así que lleva
              la misma flecha. */}
          {navegable ? (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
        </div>
      </FilaEnvuelta>
    </li>
  );
}
