"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDocumentId } from "@/lib/format";
import { type PriceCurrency } from "@/lib/products/price";
import { partirDocumento } from "@/lib/orders/order-client-match";
import {
  isUnregistered,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";
import { CLIENT_STATUS_BADGE_CLASS } from "@/lib/types";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ListPagination, PAGE_SIZE } from "@/components/dashboard/list-pagination";

// THE CATALOGUE'S ORDERS. Deliverable D, reading half.
//
// CARDS ON A PHONE, TABLE FROM `md`, which is DESIGN-SYSTEM.md's rule for a
// list of records. The grid exception written there is scoped to `/productos`
// and `/c/[token]` because a product is recognised by its photo; an order is
// recognised by who placed it and how much it is, which is exactly what a
// table aligns well.
//
// NO PER-ROW BUTTON, same rule: the whole row opens the order, and "marcar
// atendido" lives on the order's own page. A button here would compete with
// the tap-anywhere gesture on a 375px screen.

// THE ROW ARRIVES WITH ITS TEXT ALREADY FORMATTED, and that is not tidiness.
//
// This component became a CLIENT component on 2026-10-16, when the search and
// the status chip went in: the filter state lives above it, so it renders on
// the client too. `Intl` then runs in two different engines -- Node for the
// server HTML, the browser for the hydration -- and they do not agree
// character for character. The date was the one that bit: Node writes
// "7:34 p." + U+00A0 + "m." and the browser writes a different space, so React
// threw `Hydration failed because the server rendered text didn't match` and
// re-rendered the whole list on the client.
//
// Formatting upstream, in the page, which is a Server Component, means this
// file runs no `Intl` at all. It also keeps the time zone where it belongs:
// the business's, decided from the owner's country, never the browser's.
export type OrderWithItems = CatalogOrderRow & {
  items: CatalogOrderItemRow[];
  // "16 oct. 2026, 7:34 p. m.", in the shop's zone.
  llegoEl: string;
  // One per currency, already written out: {currency: "USD", texto: "$204.00"}.
  importes: { currency: string; texto: string }[];
};

// THE FLAG GOES BESIDE THE AMOUNT. Owner's request, 2026-10-16, for this
// screen and for the detail's totals.
//
// It is not decoration and it is not redundant with the `$`/`€` the formatter
// already prints: USDT has no symbol of its own, so a USDT line would read as
// a bare number next to two that carry one. The flag is the only mark that
// tells the three apart at a glance, which is the whole job of this column
// when an order mixes currencies.
function Importes({ importes }: { importes: OrderWithItems["importes"] }) {
  if (importes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5 tabular-nums">
      {importes.map((i) => (
        <span key={i.currency} className="flex items-center justify-end gap-1.5">
          <CurrencyFlagIcon currency={i.currency as PriceCurrency} />
          {i.texto}
        </span>
      ))}
    </span>
  );
}

function Estado({ order }: { order: CatalogOrderRow }) {
  if (isUnregistered(order)) {
    // ── MISMO CHIP QUE UN CLIENTE EN «Crítico» ────────────────────────
    //
    // Instrucción del dueño el 2026-10-20: *«el estilo de esas chips debe ser
    // el mismo de clientes en estado Crítico»*.
    //
    // Era `bg-destructive text-white`: un chip ROJO MACIZO, el único de la
    // app. Los demás estados --de un cliente, de una cuota, de un plazo-- son
    // todos pastel con borde, así que éste no se leía como «uno más de la
    // familia» sino como una alerta de otro orden. Un pedido sin atender es
    // urgente, no excepcional.
    //
    // Se reutiliza `CLIENT_STATUS_BADGE_CLASS.critico` y no se copian sus
    // clases: lleva su variante oscura y su contraste medido, y una copia se
    // quedaría atrás el día que ese token se afine.
    return (
      <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS.critico}>
        Sin registrar
      </Badge>
    );
  }
  // The other three statuses read the same from here: none of them is
  // asking for anything any more. The detail page does tell them apart,
  // because that is where the difference means something.
  // MISMO CHIP QUE UN CLIENTE «Dentro del plazo», por instrucción del dueño
  // el 2026-10-20. Era `variant="secondary"` --gris liso-- y el de al lado ya
  // es el de «Crítico»: dos chips de la misma columna sacados de dos paletas
  // distintas se leen como si midieran cosas distintas.
  return (
    <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS.dentro_del_plazo}>
      Registrado
    </Badge>
  );
}

export function OrdersList({
  orders,
  vacio,
}: {
  orders: OrderWithItems[];
  // EL ESTADO VACÍO LO PINTA LA PÁGINA Y LLEGA HECHO. Desde el 2026-10-19 lleva
  // dos botones --«Compartir catálogo» y «Crear producto»-- y el primero
  // necesita el enlace del catálogo y cuántos productos hay publicados, que son
  // datos del servidor. Montarlo aquí obligaría a hacerlos viajar hasta un
  // componente de cliente que no los usa para nada más.
  //
  // El respaldo de abajo se queda por si alguien monta esta lista sin pasarlo:
  // una pantalla sin estado vacío se lee como una que no cargó.
  vacio?: ReactNode;
}) {
  // ── PAGINADO, LA MISMA REGLA QUE CLIENTES ────────────────────────────
  //
  // Encargo del dueño el 2026-10-20. Hasta hoy esta lista pintaba TODOS los
  // pedidos de un negocio de una vez.
  //
  // AQUÍ Y NO EN `OrdersResults`, que es quien filtra: la paginación corta lo
  // que ya pasó el filtro, así que tiene que vivir donde están las filas que
  // de verdad se dibujan. Y por eso NO hace falta volver a la página 1 al
  // filtrar: `OrdersResults` saca esta lista de la pantalla entera cuando el
  // filtro no deja nada, así que este componente se vuelve a montar con su
  // estado en 1.
  const [page, setPage] = useState(1);
  const paginas = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const paginaSegura = Math.min(page, paginas);
  const pagina = orders.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE);

  if (orders.length === 0) {
    return (
      vacio ?? (
        <EmptyState
          title="Todavía no te ha llegado ningún pedido por el catálogo"
          subtitle="Cuando alguien pida desde tu enlace, aparece aquí."
        />
      )
    );
  }

  return (
    <>
      {/* TELÉFONO */}
      <div className="flex flex-col gap-3 md:hidden">
        {pagina.map((order) => (
          <Link
            key={order.id}
            href={`/productos/ordenes/${order.id}`}
            className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{order.customer_name}</span>
              {/* IT WRAPS, IT DOES NOT TRUNCATE. It was `truncate` until the
                  flags went in beside the amount on 2026-10-16: the right
                  column grew ~22px and "2 productos" started coming out as
                  "2 product…" at 375px. Hiding how many products an order
                  has to keep one tidy line is the wrong trade — the card can
                  be two lines tall. The name above still truncates, because
                  a name is recognised from its start. */}
              <span className="text-xs text-muted-foreground">
                {order.llegoEl} ·{" "}
                {/* The count and its noun break as one piece, so a second
                    line reads "2 productos" rather than leaving the "2"
                    stranded at the end of the first. */}
                <span className="whitespace-nowrap">
                  {order.items.length} {order.items.length === 1 ? "producto" : "productos"}
                </span>
              </span>
              <span>
                <Estado order={order} />
              </span>
            </span>
            <span className="shrink-0 text-right text-sm font-semibold">
              <Importes importes={order.importes} />
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>

      {/* DESDE md */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Llegó</TableHead>
              <TableHead>Productos</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagina.map((order) => (
              <TableRow key={order.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {order.customer_name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {/* LA LETRA PUEDE VENIR PEGADA AL DOCUMENTO, no solo en
                        su columna: `catalog_orders` tiene filas con
                        «V-24242424» dentro de `customer_document` porque el
                        carrito no siempre guarda el tipo aparte. `partirDocumento`
                        las separa; pasarle el par en crudo perdía la letra.
                        Reportado por el dueño el 2026-10-25 en la tarjeta del
                        pedido, y esta lista la dibujaba igual. */}
                    {(() => {
                      const { digits, letter } = partirDocumento(
                        order.customer_document,
                        order.customer_document_type,
                      );
                      return formatDocumentId(digits, letter);
                    })()}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {order.llegoEl}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {order.items.length}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    <Estado order={order} />
                  </Link>
                </TableCell>
                <TableCell className="text-right font-semibold">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    <Importes importes={order.importes} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ListPagination page={paginaSegura} pageCount={paginas} onPage={setPage} />
    </>
  );
}
