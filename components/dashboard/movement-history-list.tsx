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
import { MovementDetailPopover } from "@/components/dashboard/movement-detail-popover";
import {
  MovementTypeFilter,
  type TipoFiltro,
} from "@/components/dashboard/movement-type-filter";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatDate, truncateText } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
import type { Movement } from "@/lib/types";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { VentaDeContado } from "@/lib/ventas-de-contado";
import type { DatosParaCompartir } from "@/lib/share-balance";

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


export function MovementHistoryList({
  movements,
  photoUrls,
  ledger = null,
  compartir = null,
  titulo = null,
  productosPorMovimiento,
  ventasDeContado = [],
}: {
  movements: Movement[];
  photoUrls: Record<string, string>;
  // Con que comparte la ficha de cada movimiento — el mismo enlace y el mismo
  // mensaje que "Compartir enlace" del perfil. Ver lib/share-balance.ts.
  compartir?: DatosParaCompartir | null;
  // null = plain COP ledger — see MovementDetailPopover.
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
  // QUÉ SE LLEVÓ EL CLIENTE en cada movimiento, indexado por su id. La página
  // lo trae en una sola consulta para toda la lista; aquí solo se reparte.
  // Opcional porque la pantalla del cliente no lo pasa -- ver la nota de la
  // prop `productos` en MovementDetailPopover.
  productosPorMovimiento?: Map<string, SaleLineRow[]>;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  // ── LAS DOS CLASES DE FILA, EN UNA SOLA LISTA ─────────────────────
  //
  // Un movimiento y una venta de contado no comparten tabla ni forma, así que
  // se juntan aquí con una marca y se ordenan por fecha. La alternativa
  // --dos listas, una debajo de otra-- rompería lo único que el tendero busca
  // en esta pantalla: qué pasó, en orden.
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

  // LA CABECERA SE PINTA SIEMPRE, incluso sin un solo movimiento. Si
  // desapareciera con la lista, un filtro que no deja nada se llevaría por
  // delante el único control que sirve para deshacerlo.
  const cabecera = titulo ? (
    <div className="flex items-center justify-between gap-3">
      {titulo}
      {movements.length + ventasDeContado.length > 0 ? (
        <MovementTypeFilter tipo={tipo} setTipo={setTipo} conContado={ventasDeContado.length > 0} />
      ) : null}
    </div>
  ) : null;

  if (movements.length + ventasDeContado.length === 0) {
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
        <div className="rounded-lg border px-6 py-8 text-center">
          <p className="text-base">Todavía no hay transacciones registradas.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Para registrar una transacción selecciona “Agregar abono” o “Venta o fiado”
          </p>
        </div>
      </div>
    );
  }

  // "No hay de ese tipo" no es "no hay ninguno", y la segunda frase sería
  // falsa con la lista entera a un toque de distancia.
  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene{" "}
          {tipo === "charge" ? "fiados" : tipo === "payment" ? "abonos" : "ventas de contado"}{" "}
          registrados.
        </p>
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
          const balance = formatLedgerAmount(m.running_balance, m.currency, ledger);

          return (
          <li key={m.id}>
            <MovementDetailPopover
              movementId={m.id}
              type={m.type}
              amount={m.amount}
              currency={m.currency}
              description={m.description}
              ownerNote={m.owner_note}
              plazoDias={m.plazo_dias}
              cuotas={m.cuotas}
              productos={productosPorMovimiento?.get(m.id) ?? []}
              createdAt={m.created_at}
              runningBalance={m.running_balance}
              photoUrl={m.photo_path ? (photoUrls[m.photo_path] ?? null) : null}
              entryCurrency={m.entry_currency}
              entryAmount={m.entry_amount}
              exchangeRateUsed={m.exchange_rate_used}
              ledger={ledger}
              compartir={compartir}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {truncateText(
                      `${m.type === "charge" ? "Fiado" : "Abono"}${m.description ? ` · ${m.description}` : ""}`,
                      34,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(m.created_at)}
                    {m.source === "photo_import" ? " · de libreta" : ""}
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
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {m.currency ? <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" /> : null}
                    Por cobrar {balance.primary}
                  </p>
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
              </button>
            </MovementDetailPopover>
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
// NO SE ABRE, TODAVÍA
//
// Las demás filas abren `MovementDetailPopover`, que está escrito sobre un
// movimiento -- su id, su saldo acumulado, su comprobante, su plazo. Una venta
// no tiene ninguna de esas cosas, así que esto es una fila de solo lectura
// hasta que esa ficha exista. Queda dicho aquí y no solo en el chat: una fila
// que no responde al toque cuando sus vecinas sí lo hacen parece rota, y el
// siguiente que la vea merece saber que es deliberado.
function FilaDeContado({ venta, ledger }: { venta: VentaDeContado; ledger: LedgerDisplay | null }) {
  const amount = formatLedgerAmount(venta.amount, venta.currency, ledger);
  // Qué se llevó, en una línea. Es lo que la fila de un fiado pone después de
  // «Fiado · », y aquí es lo único que identifica la compra.
  const que = venta.lineas.map((l) => l.name).join(", ");

  return (
    <li>
      <div className="flex w-full items-center justify-between gap-3 p-3 text-left">
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
          {/* El hueco del chevron de las otras filas, para que los importes
              queden en la misma columna. Sin esto, la fila de contado se
              desplaza cuatro píxeles a la derecha y la lista se ve torcida. */}
          <span aria-hidden="true" className="size-4 shrink-0" />
        </div>
      </div>
    </li>
  );
}
