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
import { getBalanceLabel } from "@/lib/types";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import { EmptyState } from "@/components/dashboard/empty-state";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  currency: LedgerCurrency | null;
  description: string | null;
  running_balance: number;
  needs_review: boolean;
  plazo_dias: number | null;
  cuotas: number | null;
  // A QUÉ FIADO SE DIRIGIÓ ESTE ABONO, `null` si no se dirigió a ninguno.
  // Lo manda `get_shared_balance` desde la `126`. Decide si la fila sale en
  // el historial: un abono dirigido vive dentro de su fiado.
  applies_to_movement_id?: string | null;
  // WHAT THIS FIADO STILL OWES — migration `132`, null on a payment. Optional
  // because a `get_shared_balance` where `132` has not run does not send the
  // key at all, and the row then draws no figure instead of a zero that would
  // read as «paid».
  pending?: number | null;
  created_at: string;
  rate_mode_used: ExchangeRateMode | null;
  exchange_rate_used: number | null;
  official_bcv_rate_at_time: number | null;
  entry_currency: MovementCurrencyCode | null;
  entry_amount: number | null;
  rate_usd_at_time: number | null;
  rate_eur_at_time: number | null;
};

// UNA VENTA PAGADA ENTERA, tal como la devuelve `get_shared_balance` desde la
// migración `131`. No es un movimiento: una venta pagada no escribe nada en
// `movements` (la `124`), así que llega por su propia clave del JSON y esta
// lista las mezcla al pintar. El gemelo del tendero, `VentaDeContado`, dice lo
// mismo con otros nombres porque viene de otra consulta.
export type SharedVentaDeContado = {
  sale_id: string;
  created_at: string;
  currency: LedgerCurrency | null;
  amount: number;
  lineas: { name: string; quantity: number; unit_price: number }[];
  // Lo que el cliente entregó y en qué, más la tasa sellada el día del pago y
  // la nota. La lista no los usa --los usa el detalle, que lee el mismo
  // payload-- y van en el tipo para que haya UN solo contrato con la `131`.
  entry_currency?: string | null;
  entry_amount?: number | null;
  rate_used?: number | null;
  description?: string | null;
};

const PAGE_SIZE = 10;


// EL FILTRO POR TIPO, pedido por el dueño el 2026-10-16: "Todos", "Fiado" y
// "Abono", a la derecha del rótulo "Historial". Gemelo del de la lista del
// tendero (`components/dashboard/movement-history-list.tsx`), y en dos copias
// a propósito: esta lista es la que ve el CLIENTE, con sus propios tipos y su
// propio contrato de datos, y juntarlas obligaría a una sola forma para dos
// pantallas que ya se han separado antes.


export function MovementHistoryList({
  movements,
  ventasDeContado = [],
  token,
  ledger = null,
  titulo = null,
}: {
  movements: SharedMovement[];
  // LAS VENTAS PAGADAS ENTERAS, que llegan aparte por lo dicho en
  // `SharedVentaDeContado`. Vacío en todo cliente sin ventas de contado, y
  // también mientras la migración `131` no esté corrida: la clave no viene y
  // la pantalla enseña lo de siempre en vez de romperse.
  ventasDeContado?: SharedVentaDeContado[];
  // EL TOKEN DE LA DIRECCIÓN QUE EL CLIENTE YA TIENE ABIERTA. Cada fila lleva
  // a `/s/<token>/t/<id>` desde el 2026-10-19, cuando el detalle dejó de ser un
  // diálogo. Es lo único que hace falta para construir ese enlace, y el cliente
  // ya lo trae en la barra del navegador.
  token: string;
  ledger?: LedgerDisplay | null;
  // El rótulo de la sección, para poder poner el filtro a su derecha.
  titulo?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  // ── LAS DOS CLASES DE FILA, EN UNA SOLA LISTA ────────────────────────
  //
  // Igual que en la lista del tendero y por lo mismo: un movimiento y una
  // venta pagada entera no comparten tabla ni forma, así que se juntan aquí
  // con una marca y se ordenan por fecha. Dos listas separadas romperían lo
  // único que el cliente busca al abrir su enlace: qué pasó, en orden.
  //
  // ABONOS BACK IN, ALL OF THEM — same rule and same reasoning as the
  // shopkeeper's list, whose long comment lives in
  // `components/dashboard/movement-history-list.tsx`. Asked for by the owner
  // on 2026-10-22, reversing his own 2026-10-20 decision to hide them.
  //
  // THIS FILE ARGUED FOR EXACTLY THIS until that day, and the argument is kept
  // because it is now the reason rather than the cost: for the OWNER an abono
  // is a duplicate — it is already visible inside the fiado it paid — while
  // for a CLIENT it is the receipt that he paid, and often the whole reason he
  // opens the link. Hiding it put that receipt one tap further in. The two
  // screens stay identical, which is the thing Sevenz is for: the shopkeeper
  // and the customer reading the same account and seeing the same rows.
  //
  // AND THE DATE OF A FIADO IS ITS OWN AGAIN. It showed its last abono's date
  // from 2026-10-21, which made sense while abonos were hidden; with the abono
  // on its own row it only produced a list that sorted by one date and printed
  // another. Decided by the owner on 2026-10-22.
  const filas: Fila[] = [
    ...movements.map((m): Fila => ({ clase: "movimiento", fecha: m.created_at, m })),
    ...ventasDeContado.map((v): Fila => ({ clase: "contado", fecha: v.created_at, v })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const visibles =
    tipo === "todos"
      ? filas
      : filas.filter((f) =>
          tipo === "cash" ? f.clase === "contado" : f.clase === "movimiento" && f.m.type === tipo,
        );

  // La cabecera se pinta siempre: un filtro que no deja nada no puede
  // llevarse por delante el control que sirve para deshacerlo.
  const cabecera = titulo ? (
    <div className="flex items-center justify-between gap-3">
      {titulo}
      {filas.length > 0 ? <MovementTypeFilter
          tipo={tipo}
          setTipo={setTipo}
          conAbono={filas.some((f) => f.clase === "movimiento" && f.m.type === "payment")}
          conContado={ventasDeContado.length > 0}
        /> : null}
    </div>
  ) : null;

  if (filas.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        {/* LA MISMA CAJA, PERO SIN LA SEGUNDA LÍNEA. La del tendero dice qué
            botón tocar; aquí esos botones no existen —el cliente no registra
            nada, solo mira— y una instrucción que no se puede seguir es peor
            que ninguna. */}
        <EmptyState title="Todavía no hay transacciones registradas" />
      </div>
    );
  }

  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <EmptyState
          // «abonos» ya no es una opción del filtro, así que tampoco puede
          // salir aquí: el texto solo puede nombrar algo que se pueda elegir.
          title={`No tienes ${tipo === "charge" ? "fiados" : "compras de contado"} en este historial`}
        />
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedMovements = visibles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {cabecera}
      <ul className="flex flex-col divide-y rounded-lg border">
        {pagedMovements.map((fila) => {
          if (fila.clase === "contado") {
            return (
              <FilaDeContado
                key={`venta-${fila.v.sale_id}-${fila.v.currency ?? "cop"}`}
                venta={fila.v}
                token={token}
                ledger={ledger}
              />
            );
          }
          const m = fila.m;
          const amount = formatLedgerAmount(m.amount, m.currency, ledger);
          // Lo mismo que en la lista del dueño, y por un motivo que aqui pesa
          // mas: el cliente y el comercio tienen que ver EL MISMO numero. Si el
          // dueño anota Bs. 900 y el cliente abre su enlace y lee 899,09, eso
          // es justo la discusion que esta app existe para evitar.
          const bsTecleados =
            m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : null;
          // WHAT THIS FIADO STILL OWES, not the client's running balance.
          //
          // With the abonos gone from the list, `running_balance` stops being
          // readable: it is the balance in that book AFTER each movement, so
          // the client would see a $50 fiado at «Saldo: $120» and below it a
          // $30 fiado at «Saldo: $80» — a balance going DOWN after a new debt,
          // with the rows that explain it no longer on screen.
          //
          // The same swap was made on the owner's list the same day, and it
          // was found there the hard way: one row said $89.72 while the card
          // above it said $68.59, and nothing said which figure to charge.
          //
          // `pending` arrives with migration `132`. Until it has run the key
          // is missing, and `?? null` keeps the line off rather than printing
          // a zero that would read as «paid».
          const pendienteDeEsteFiado = m.type === "charge" ? (m.pending ?? null) : null;
          // MISMA REGLA QUE EN LA DEL TENDERO (ver su comentario largo): el
          // fiado enseña lo que ESE fiado debe, el abono el saldo que quedaba
          // tras él. Decisión del dueño el 2026-10-21.
          // SIN SIGNO, porque el rótulo de al lado ya lo lleva: la fila de un
          // abono dice «A favor $178.00» y no «A favor −$178.00». Instrucción
          // del dueño el 2026-10-21, con la misma razón que en la tarjeta de
          // saldo de esta pantalla — el rótulo sale de `getBalanceLabel`, que
          // es quien decide entre «Debe», «A favor» y «Sin deuda».
          //
          // Un fiado no necesita el `abs`: su pendiente nunca es negativo.
          const cifraDeLaLinea =
            m.type === "charge" ? pendienteDeEsteFiado : Math.abs(m.running_balance);
          const balance = formatLedgerAmount(cifraDeLaLinea ?? 0, m.currency, ledger);

          return (
          <li key={m.id}>
            {/* AN ABONO OPENS THE FIADO IT PAID, not its own detail — same as
                the shopkeeper's list, asked for on 2026-10-22. From there its
                own card leads to the abono's detail.

                `?? m.id` IS NOT REDUNDANT: an undirected abono has no fiado to
                open, so it falls back to its own page. They all predate
                2026-10-14. */}
            <Link
              href={`/s/${token}/t/${m.applies_to_movement_id ?? m.id}`}
              className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            >
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
                  {/* SU PROPIA FECHA, que es también la que ordena la lista.
                      Ver arriba por qué dejó de ser la del último abono. */}
                  <p className="text-xs text-muted-foreground">{formatDate(m.created_at)}</p>
                  {/* EL CHIP «Pagado» DE UN FIADO SALDADO, igual que en la
                      lista del tendero y por la misma razón — ver su
                      comentario. Aquí el estado sale de `pending`, que llega
                      con la migración `132`: sin ella la clave no viene, el
                      pendiente es `null` y no se dibuja nada, que es como
                      estaba antes. */}
                  {m.type === "charge" && m.pending != null && m.pending <= 0.005 ? (
                    <ChipDeEstado estado="pagado" />
                  ) : null}
                  {/* LA LÍNEA SE QUEDA SOLO EN EL ABONO. El frame dibuja la
                      del fiado a la DERECHA, con su rótulo encima, y no
                      contempla el abono — que aquí solo sale cuando no está
                      dirigido a ningún fiado.

                      `getBalanceLabel` en vez de «Te queda por pagar»: el
                      saldo de un abono puede estar A FAVOR, y ahí esa frase
                      sería falsa. Decidido el 2026-10-21. */}
                  {m.type === "payment" ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                      ) : null}
                      {getBalanceLabel(m.running_balance)} {balance.primary}
                    </p>
                  ) : null}
                </div>
                {/* LA DERECHA, frame `1512:10061`: en un FIADO el rótulo
                    «Por cobrar», lo que queda de ESE fiado y sus bolívares de
                    HOY —la deuda sigue viva—. En lo demás, el importe y sus
                    bolívares. Mismo reparto que la lista del tendero.

                    «Por cobrar» Y NO «Te queda por pagar» aquí arriba: el
                    frame escribe ese rótulo, y es el mismo en las dos
                    pantallas. La frase propia del cliente queda en el detalle,
                    donde hay sitio para una oración entera. */}
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

// Una fila del historial del cliente: o un movimiento, o una venta pagada
// entera. Gemela de la `Fila` de la lista del tendero, en dos copias por lo
// mismo que las listas: dos contratos de datos distintos.
type Fila =
  | { clase: "movimiento"; fecha: string; m: SharedMovement }
  | { clase: "contado"; fecha: string; v: SharedVentaDeContado };

// UNA VENTA DE CONTADO EN EL HISTORIAL DEL CLIENTE — migración `131`, `CT-104`.
//
// ===========================================================================
// POR QUÉ ESTA FILA IMPORTA MÁS AQUÍ QUE EN LA PANTALLA DEL TENDERO
//
// Hasta la `131` el cliente pagaba su compra entera, se llevaba lo suyo, abría
// su enlace a comprobar... y la compra no estaba. El tendero sí la veía. Los
// dos mirando la misma cuenta y leyendo cosas distintas es exactamente lo que
// esta app existe para evitar.
//
// VERDE Y SIN SIGNO, como en la lista del tendero y por la misma razón: el
// fiado (rojo, «+») SUBE la deuda, el abono (azul, «−») la BAJA, y el contado
// NO LA TOCA. Un «+» o un «−» aquí prometerían un movimiento del saldo que no
// ocurre, y a quien lo lee es a quien le toca pagarlo.
//
// `emerald-700` y no el `600`: medido contra blanco, el 600 da 3,67:1 y el
// piso de `DESIGN-SYSTEM.md` son 4,5. El 700 da 5,37:1.
function FilaDeContado({
  venta,
  token,
  ledger,
}: {
  venta: SharedVentaDeContado;
  token: string;
  ledger: LedgerDisplay | null;
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
    venta.rate_used == null ? null : formatBs(venta.amount * Number(venta.rate_used));


  return (
    <li>
      <Link
        href={`/s/${token}/v/${venta.sale_id}/${(venta.currency ?? "cop").toLowerCase()}`}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="shrink-0 whitespace-nowrap">
          <p className="truncate text-sm font-medium">
            {truncateText(`De contado${que ? ` · ${que}` : ""}`, 34)}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(venta.created_at)}</p>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
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
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>
    </li>
  );
}
