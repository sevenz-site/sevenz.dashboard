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
  // ── LOS ABONOS NO SALEN AQUÍ. NINGUNO ────────────────────────────────
  //
  // Decisión del dueño el 2026-10-20, y la eligió con el coste delante:
  // *«como el fiado se lleva sobre una misma cuenta, agregar los movimientos
  // de abonos por separados en el historial sería redundante, esos abonos
  // deberían aparecer solo sobre el movimiento del detalle del fiado, es
  // decir viven solo ahí, no se ven en el historial»*.
  //
  // ── QUÉ ABONOS SALEN AQUÍ: SOLO LOS QUE NO TIENEN OTRO SITIO ──────
  //
  // Regla del dueño, 2026-10-21, después de que las dos pantallas los
  // escondieran todos durante un día:
  //
  //   abono DIRIGIDO a un fiado  → NO sale aquí. Vive dentro de ese fiado,
  //                                que es donde él decidió que viven.
  //   abono SIN DIRIGIR          → SÍ sale aquí, porque no hay ningún fiado
  //                                donde pueda verse.
  //
  // POR QUÉ ESTA REGLA Y NO «NINGUNO», que fue lo que se hizo el 2026-10-20 y
  // duró un día: esconderlos todos daba por hecho que «ya se ven dentro del
  // fiado», y eso solo es cierto para los dirigidos. Un abono sin dirigir no
  // pertenece a ningún cargo — la cola FIFO lo repartió entre los más viejos
  // sin dejar constancia de a cuál— así que al ocultarlo desaparecía de la
  // app entera: ni aquí, ni dentro de ningún fiado, ni para el tendero ni
  // para el cliente. Medido ese día: 104 de 115.
  //
  // SE APAGA SOLA, y esa es la mejor parte. Desde el 2026-10-14 el flujo de
  // abono obliga a elegir el fiado antes de pedir el monto, así que todo lo
  // que entra nuevo va dirigido — comprobado contra la base: el último abono
  // sin dirigir es de ese día. Esta rama solo alcanza a lo histórico, y se
  // vaciará sola a medida que esos abonos dejen de estar a la vista. No hay
  // nada que quitar luego.
  //
  // SE FILTRA AQUÍ Y NO EN LA CONSULTA a propósito: `movements` sigue
  // llegando entero porque la fila de un fiado necesita su `running_balance`,
  // que se calcula contra todos los movimientos. Pedir menos a la base
  // ahorraría nada y rompería esa columna.
  const esAbonoDirigido = (m: { type: string; applies_to_movement_id: string | null }) =>
    m.type === "payment" && m.applies_to_movement_id != null;

  // ── LA FECHA QUE ENSEÑA UN FIADO: LA DE SU ÚLTIMO ABONO ──────────────
  //
  // Frame `1512:10061` y las palabras del dueño el 2026-10-21: *«fecha de
  // registro de la transacción (en caso de venta de contado) y fecha de
  // último abono (en caso de fiado)»*.
  //
  // SIN ABONOS DIRIGIDOS SE QUEDA LA SUYA. No es una elección de estilo: es la
  // única fecha que ese fiado tiene. Dejar la fila sin fecha sería peor que
  // dar la de su registro, que además es literalmente «la última vez que pasó
  // algo con este fiado».
  //
  // SE CALCULA CON LOS MOVIMIENTOS QUE YA LLEGAN, sin pedir nada más: los
  // abonos dirigidos están en esta misma lista con su `applies_to_movement_id`
  // —aunque no se dibujen— así que el dato ya estaba aquí.
  const ultimoAbonoPorFiado = new Map<string, string>();
  for (const m of movements) {
    if (!esAbonoDirigido(m) || !m.applies_to_movement_id) continue;
    const previo = ultimoAbonoPorFiado.get(m.applies_to_movement_id);
    if (!previo || m.created_at > previo) {
      ultimoAbonoPorFiado.set(m.applies_to_movement_id, m.created_at);
    }
  }
  const filas: Fila[] = [
    ...movements
      .filter((m) => !esAbonoDirigido(m))
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
          const pendienteDeEsteFiado =
            m.type === "charge" ? (pendientePorFiado[m.id] ?? 0) : null;

          // ── QUÉ CIFRA LLEVA LA LÍNEA GRIS, Y SON DOS DISTINTAS ────────
          //
          // FIADO  → lo que ESE fiado todavía debe (`pendientePorFiado`).
          // ABONO  → el saldo del cliente justo DESPUÉS de ese pago
          //          (`running_balance`), que es lo que hay en producción.
          //
          // Decisión del dueño el 2026-10-21, elegida entre tres y con el
          // coste delante: lo vio al comparar la app con producción, donde la
          // fila del abono dice «Por cobrar $108.95» y aquí no decía nada —
          // la línea se perdió el 2026-10-20 al pasar el fiado a su propio
          // pendiente, porque la condición dejó fuera todo lo que no fuera un
          // cargo.
          //
          // EL COSTE QUE ACEPTÓ: «Por cobrar» mide dos cosas según la fila.
          // En un fiado se comprueba abriéndolo; en un abono es el saldo de
          // aquel momento. Se le ofreció un rótulo propio para el abono y
          // prefirió que fuera idéntico a producción, para no cambiarle la
          // lectura a quien ya la conoce.
          const cifraDeLaLinea =
            m.type === "charge" ? pendienteDeEsteFiado : m.running_balance;
          const balance = formatLedgerAmount(cifraDeLaLinea ?? 0, m.currency, ledger);
          // El mismo reparto para las dos clases de fila: con `navegable` es
          // un enlace; sin él, un `div` con las mismas clases menos el
          // `hover`, que prometería algo que no pasa.
          return (
          <li key={m.id}>
            <FilaEnvuelta href={navegable ? `/transacciones/${m.id}` : null}>
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
                  <p className="truncate text-sm font-medium">
                    {truncateText(
                      `${m.type === "charge" ? "Fiado" : "Abono"}${m.description ? ` · ${m.description}` : ""}`,
                      34,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(
                      m.type === "charge"
                        ? (ultimoAbonoPorFiado.get(m.id) ?? m.created_at)
                        : m.created_at,
                    )}
                  </p>
                  {/* LA LÍNEA DEL ABONO SE QUEDA AQUÍ, y es la única que
                      sobrevive en esta columna. El frame dibuja dos filas —la
                      de contado y la del fiado— y no contempla el abono, que
                      en esta lista solo aparece cuando no está dirigido a
                      ningún fiado. Su «Por cobrar» lo decidió el dueño el
                      2026-10-21, un día antes que este frame, y nada de lo que
                      el frame dice lo contradice. */}
                  {m.type === "payment" ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {m.currency ? <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" /> : null}
                      Por cobrar {balance.primary}
                    </p>
                  ) : null}
                </div>
                {/* ── LA DERECHA: CUÁNTO ──────────────────────────────
                    Frame `1512:10061`. En un FIADO son tres renglones: el
                    rótulo «Por cobrar», el saldo que queda de ESE fiado con su
                    bandera, y sus bolívares de HOY — porque esa deuda sigue
                    viva y la pregunta es cuánto vale ahora. En lo demás, el
                    importe y sus bolívares, sin rótulo.

                    EL IMPORTE DEL FIADO DEJA DE SER LO QUE SE FIÓ y pasa a ser
                    lo que queda: *«saldo total por cobrar de ese fiado»*, sus
                    palabras del 2026-10-21. Es el mismo número que el detalle
                    llama «Total por cobrar», que es de donde salió el encargo:
                    la fila decía lo que se fió y daba a entender que no se
                    había abonado nada. */}
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                  <div
                    className={`flex min-w-0 flex-col items-end text-right tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                  >
                    {m.type === "charge" ? (
                      <span className="text-xs font-normal text-muted-foreground">Por cobrar</span>
                    ) : null}
                    <span className="flex items-center gap-1">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                      ) : null}
                      {m.type === "charge" ? "+" : "-"}
                      {m.type === "charge" ? balance.primary : amount.primary}
                    </span>
                    {(m.type === "charge" ? balance.secondary : (bsTecleados ?? amount.secondary)) ? (
                      <span className="font-normal text-muted-foreground">
                        {m.type === "charge" ? balance.secondary : (bsTecleados ?? amount.secondary)}
                      </span>
                    ) : null}
                  </div>
                  {navegable ? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                </div>
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
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const base = "flex w-full items-center justify-between gap-3 p-3 text-left";
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
