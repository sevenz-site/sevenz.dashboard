"use client";

import { useState } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  FiltrosDelHistorial,
  tituloDeListaVacia,
  type EstadoFiltro,
  type MonedaFiltro,
  type TipoFiltro,
} from "@/components/dashboard/movement-type-filter";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { EstadoDelChip } from "@/components/dashboard/chip-de-estado";
import { HistoryCard } from "@/components/dashboard/history-card";
import { groupPayments } from "@/lib/history/group-payments";
import { vencimientoEfectivo } from "@/lib/estado-del-plazo";
import { getClientStatus } from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
// `getBalanceLabel` left this file on 2026-10-22 with the abono's own
// «A favor / Debe» line: tier 2 writes «Por cobrar» for both types, which the
// frames give alike. It still lives in `lib/types` and the balance card on
// this same page still uses it.
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import { EmptyState } from "@/components/dashboard/empty-state";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  // El código de su transacción — migración 148, para el buscador.
  transaction_code?: string | null;
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
  // The sale's product names, from migration `139`. Absent in an environment
  // where it has not run, and then the row falls back to the description.
  productos?: { name: string }[] | null;
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
  // El código de la transacción — migración 148. Una venta pagada entera no
  // escribe movimiento, así que el suyo vive en `sales` y llega por aquí.
  transaction_code?: string | null;
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
  diasSinPagar = 0,
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
  // ── CUÁNTOS DÍAS LLEVA EL CLIENTE SIN ABONAR NADA ────────────────────
  //
  // Lo único que una fila no puede saber por sí misma y que hace falta para
  // que diga «Crítico»: es un dato del CLIENTE, no del movimiento. Baja de la
  // página, que ya lo tiene leído.
  //
  // CERO POR DEFECTO, que es el lado seguro: con cero nadie llega nunca a
  // «Crítico», así que una pantalla que olvide pasarlo enseña el estado más
  // suave en vez de inventarse una alarma.
  diasSinPagar?: number;
  // ── LO QUE DEBE EN CADA LIBRO, PARA LAS FILAS SIN FIADO ──────────────
  //
  // Clave: `"USD"`, `"EUR"` o `"COP"`. Hace falta solo para el abono suelto,
  // que no tiene un fiado cuyo pendiente enseñar.
  //
  // AQUÍ ESTUVO `saldoPorMoneda`, que la fila del abono suelto necesitaba
  // para tener pie. Se fue el 2026-10-23 al pasar el pie a `running_balance`,
  // que viene en el propio movimiento. Ver la lista del tendero.
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [estado, setEstado] = useState<EstadoFiltro>("todos");
  const [moneda, setMoneda] = useState<MonedaFiltro>("todas");

  // EL CÓDIGO TECLEADO. Cadena vacía es «sin filtrar», no «ningún código»:
  // un buscador que no deja ver nada mientras está vacío sería un filtro
  // puesto que nadie pidió.
  const [codigo, setCodigo] = useState("");

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
  // To find the fiado an abono paid without scanning the list on every row.
  const porId = new Map(movements.map((m) => [m.id, m]));

  // EL PIE DE UNA FILA, CALCULADO UNA VEZ. Igual que en la lista del tendero
  // y por lo mismo: el filtro por estado necesita el MISMO chip que se
  // dibuja, o devolvería filas que no lo llevan.
  function pieDeLaFila(m: SharedMovement) {
        const fiadoDeLaFila =
          m.type === "charge" ? m : (porId.get(m.applies_to_movement_id ?? "") ?? null);
        const pendienteDelFiado = fiadoDeLaFila?.pending ?? null;
        // QUÉ CIFRA VA AQUÍ: el saldo que ese libro debía DESPUÉS de este
        // movimiento, `running_balance`. Encargo del dueño el 2026-10-23, y
        // su criterio de cierre —la última fila y la tarjeta de arriba
        // tienen que coincidir—, que se cumple por construcción. El porqué
        // largo, y la regla del 2026-10-21 que esto desplaza, están en la
        // lista del tendero.
        const cifraPorCobrar = m.running_balance ?? null;
        // Y UN SALDO A FAVOR NO SE ESCRIBE CON UN MENOS: la cifra va en
        // absoluto y el chip dice de quién es. Es lo que la tarjeta de
        // arriba ya hacía con su `Math.abs` y su «A favor».
        const aFavor = cifraPorCobrar != null && cifraPorCobrar < 0;
        // ── EL CHIP DE LA FILA: UNO SOLO, Y EL MISMO JUEZ QUE LA TARJETA ──
        //
        // Encargo del dueño el 2026-10-23, en dos pasos. El primero: que cada
        // fiado diga en qué va sin tener que abrirlo. El segundo, al no
        // encontrar en el historial el fiado que ponía «Crítico» a su
        // tarjeta: que la fila hable el MISMO idioma que esa tarjeta.
        //
        // Por eso quien juzga es `getClientStatus`, el mismo de las tarjetas
        // y las listas, aplicado al fiado en vez de al libro: su saldo es lo
        // que ESE fiado debe, y su «peor cargo» es él mismo. Con eso, un
        // fiado vencido o sin plazo de un cliente que lleva más de 30 días
        // sin abonar sale «Crítico», igual que su tarjeta.
        //
        // «PAGADO» SE RESUELVE ANTES y no por `getClientStatus`, que para un
        // saldo en cero diría «Sin deuda»: un fiado saldado no es una cuenta
        // sin deuda, es un fiado que se pagó, y esa palabra la pidió el dueño
        // el 2026-10-21 por su nombre.
        //
        // UN FIADO SIN FECHA dice «Sin plazo» y no se queda en blanco, que es
        // lo que `getClientStatus` ya hace sin ayuda.
        const chipDeLaFila: EstadoDelChip | null =
          m.type === "charge"
            ? pendienteDelFiado == null
              ? null
              : pendienteDelFiado <= 0.005
                ? "pagado"
                : getClientStatus({
                    balance: pendienteDelFiado,
                    daysSincePayment: diasSinPagar,
                    worstChargeAt: m.created_at,
                    worstChargePlazoDias: m.plazo_dias,
                    worstChargeDueAt:
                      vencimientoEfectivo({
                        createdAt: m.created_at,
                        plazoDias: m.plazo_dias,
                        cuotas: m.cuotas,
                        amount: Number(m.amount),
                        pendiente: pendienteDelFiado,
                      })?.toISOString() ?? null,
                  })
            : aFavor
              ? "a_favor"
              : null;

    return { fiadoDeLaFila, cifraPorCobrar, aFavor, chipDeLaFila };
  }


  // UN REPARTO ES UNA FILA, con la MISMA regla que la lista del tendero
  // (`lib/history/group-payments.ts`): agrupa por código de transacción, que
  // este payload sí trae desde la migración 148. Encargo del dueño el
  // 2026-10-30, y preguntado para esta vista: igual en las dos.
  const filas: Fila[] = [
    ...groupPayments(movements).map(
      ({ row: m }): Fila => ({ clase: "movimiento", fecha: m.created_at, m }),
    ),
    ...ventasDeContado.map((v): Fila => ({ clase: "contado", fecha: v.created_at, v })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  // ── EL FILTRO POR CÓDIGO ──────────────────────────────────────────
  //
  // Va EL PRIMERO de la cadena y eso importa: es el más estrecho de los
  // cuatro —deja las filas de UNA transacción— así que lo que sobrevive a él
  // es lo poco que los demás tienen que recorrer, y el orden en que el
  // tendero los lee es el mismo en que se aplican.
  //
  // `includes` Y NO `===`: el código se lee de una captura o se escucha por
  // teléfono, así que media palabra tiene que servir mientras se teclea el
  // resto. Sin distinguir mayúsculas, porque el campo las pinta en
  // mayúsculas pero no transforma lo escrito.
  //
  // UNA FILA SIN CÓDIGO NO CASA NUNCA, y es correcto: es anterior a la
  // migración 147 y no hay código por el que buscarla. Hoy no existe
  // ninguna, ni en dev ni en producción.
  // ── QUÉ SE BUSCA CON EL BUSCADOR ──────────────────────────────────
  //
  // Encargo del dueño el 2026-10-23: *«el search buscar, debe permitir buscar
  // por código, monto o producto»*. Nació buscando solo el código.
  //
  // SE BUSCA LO QUE LA FILA DICE, y por eso el texto se arma con las MISMAS
  // piezas que la fila pinta: su código, su nombre —los productos de la venta
  // o lo que el tendero escribió— y sus importes. Un buscador que mire
  // columnas que la pantalla no enseña devuelve filas que, a la vista, no
  // tienen nada que ver con lo buscado.
  //
  // LOS IMPORTES VAN EN LAS DOS FORMAS, cruda y formateada, a propósito: el
  // tendero teclea lo que recuerda («112.84») o lo que copia de la pantalla
  // («Bs. 100.001,87»), y las dos tienen que encontrar la misma fila. Es más
  // barato meter las dos cadenas que adivinar en cuál está pensando.
  //
  // Y LOS BOLÍVARES TECLEADOS TAMBIÉN, cuando los hay: para un abono pagado
  // en bolívares, esa es la cifra que el cliente entregó y la que el tendero
  // tiene en la cabeza.
  const textoDeLaFila = (f: Fila) => {
    if (f.clase === "contado") {
      return [
        f.v.transaction_code ?? "",
        f.v.lineas.map((l) => l.name).join(" "),
        String(f.v.amount),
        formatPriceAmount(f.v.amount, (f.v.currency ?? "COP") as PriceCurrency),
      ].join(" ");
    }
    const m = f.m;
    const fiado = m.type === "charge" ? m : (porId.get(m.applies_to_movement_id ?? "") ?? null);
    const nombre =
      (fiado?.productos ?? []).map((l) => l.name).join(" ") ||
      fiado?.description ||
      m.description ||
      "";
    return [
      m.transaction_code ?? "",
      nombre,
      String(m.amount),
      formatPriceAmount(Number(m.amount), (m.currency ?? "COP") as PriceCurrency),
      m.entry_amount != null ? String(m.entry_amount) : "",
      m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : "",
    ].join(" ");
  };

  const buscado = codigo.trim().toLowerCase();
  const porCodigo =
    buscado === "" ? filas : filas.filter((f) => textoDeLaFila(f).toLowerCase().includes(buscado));

  const porTipo =
    tipo === "todos"
      ? porCodigo
      : porCodigo.filter((f) =>
          tipo === "cash" ? f.clase === "contado" : f.clase === "movimiento" && f.m.type === tipo,
        );

  // El filtro mira el chip que se dibuja, no una regla paralela. Ver la lista
  // del tendero.
  const porMoneda =
    moneda === "todas"
      ? porTipo
      : porTipo.filter((f) =>
          f.clase === "movimiento" ? f.m.currency === moneda : f.v.currency === moneda,
        );

  const visibles =
    estado === "todos"
      ? porMoneda
      : porMoneda.filter(
          (f) => f.clase === "movimiento" && pieDeLaFila(f.m).chipDeLaFila === estado,
        );

  // Los libros del negocio, para el filtro de moneda. Ver la lista del
  // tendero: salen de `ledger` y no de las filas.
  const monedasDelNegocio: readonly PriceCurrency[] = ledger ? (["USD", "EUR"] as const) : [];

  // La cabecera se pinta siempre: un filtro que no deja nada no puede
  // llevarse por delante el control que sirve para deshacerlo.
  const cabecera = titulo ? (
    // Título arriba y filtros debajo, igual que en la lista del tendero y en
    // la misma sesión — ver su comentario.
    <div className="flex flex-col gap-2">
      {titulo}
      {filas.length > 0 ? (
        <FiltrosDelHistorial
          tipo={tipo}
          setTipo={(t) => {
            setTipo(t);
            setPage(1);
          }}
          estado={estado}
          setEstado={(e) => {
            setEstado(e);
            setPage(1);
          }}
          moneda={moneda}
          setMoneda={(c) => {
            setMoneda(c);
            setPage(1);
          }}
          monedas={monedasDelNegocio}
          codigo={codigo}
          setCodigo={(c) => {
            setCodigo(c);
            setPage(1);
          }}
        />
      ) : null}
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
        {/* El mismo título que en la lista del tendero, del mismo sitio:
            las dos pantallas tienen que decir lo mismo ante los mismos
            filtros. Ver `tituloDeListaVacia`. */}
        <EmptyState subtitle={tituloDeListaVacia({ tipo, estado, moneda, codigo })} />
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedMovements = visibles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {cabecera}
      {/* ── UNA CARD POR TRANSACCIÓN, NO UNA LISTA CON DIVISORES ────────
          Frame `1548:11048`, encargo del dueño el 2026-10-22: *«El historial
          de transacciones lo dejaste como tabla, son cards, una card por
          transacción»*.

          Era un solo `ul` con borde y `divide-y`: las filas compartían caja y
          se separaban con una raya. El frame les da a cada una su borde, su
          radio y su hueco.

          NO ES SOLO ESTÉTICA, Y SE NOTA DESDE QUE LA FILA TIENE DOS PISOS: con
          divisores, la raya entre «Por cobrar» y la transacción siguiente se
          ve igual que la que separa los dos pisos DENTRO de una fila, así que
          no hay forma de saber dónde acaba una transacción. El borde las
          cierra. */}
      <ul className="flex flex-col gap-2">
        {pagedMovements.map((fila) => {
          // LA MISMA TARJETA QUE LA DEL TENDERO — `HistoryCard`, frames
          // `1861:15468`, `1861:15490` y `1861:15513`, 2026-10-30. Lo único
          // propio de esta vista es a dónde abre cada una.
          if (fila.clase === "contado") {
            const v = fila.v;
            return (
              <HistoryCard
                key={`venta-${v.sale_id}-${v.currency ?? "cop"}`}
                kind="contado"
                productos={v.lineas.map((l) => l.name)}
                createdAt={v.created_at}
                amount={Number(v.amount)}
                currency={v.currency}
                ledger={ledger}
                href={`/s/${token}/v/${v.sale_id}/${(v.currency ?? "cop").toLowerCase()}`}
              />
            );
          }
          const m = fila.m;
          const { cifraPorCobrar, chipDeLaFila } = pieDeLaFila(m);
          // The sale's product names first, then what the shopkeeper typed;
          // rows before 2026-10-22 carry the name copied into `description`.
          const productos =
            m.type === "charge"
              ? (m.productos ?? []).length > 0
                ? (m.productos ?? []).map((l) => l.name)
                : m.description
                  ? [m.description]
                  : []
              : [];
          return (
            <HistoryCard
              key={m.id}
              kind={m.type === "charge" ? "fiado" : "abono"}
              productos={productos}
              createdAt={m.created_at}
              amount={Number(m.amount)}
              currency={m.currency}
              ledger={ledger}
              href={`/s/${token}/t/${m.id}`}
              porCobrar={cifraPorCobrar}
              chip={chipDeLaFila}
            />
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

// AQUÍ VIVÍA `FilaDeContado`. Se fue el 2026-10-30 a
// `components/dashboard/history-card.tsx`, la tarjeta que comparten las dos
// vistas, igual que el resto del dibujo de esta lista.
