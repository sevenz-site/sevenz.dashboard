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
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import {
  isUnattended,
  totalsByCurrency,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

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

export type OrderWithItems = CatalogOrderRow & { items: CatalogOrderItemRow[] };

// THE FLAG GOES BESIDE THE AMOUNT. Owner's request, 2026-10-16, for this
// screen and for the detail's totals.
//
// It is not decoration and it is not redundant with the `$`/`€` the formatter
// already prints: USDT has no symbol of its own, so a USDT line would read as
// a bare number next to two that carry one. The flag is the only mark that
// tells the three apart at a glance, which is the whole job of this column
// when an order mixes currencies.
function Importes({ items }: { items: CatalogOrderItemRow[] }) {
  const totales = totalsByCurrency(items);
  if (totales.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5 tabular-nums">
      {totales.map((t) => (
        <span key={t.currency} className="flex items-center justify-end gap-1.5">
          <CurrencyFlagIcon currency={t.currency as PriceCurrency} />
          {formatPriceAmount(t.amount, t.currency as PriceCurrency)}
        </span>
      ))}
    </span>
  );
}

function Estado({ order }: { order: CatalogOrderRow }) {
  if (isUnattended(order)) {
    return <Badge className="bg-destructive text-white hover:bg-destructive">Sin atender</Badge>;
  }
  // The other three statuses read the same from here: none of them is
  // asking for anything any more. The detail page does tell them apart,
  // because that is where the difference means something.
  return <Badge variant="secondary">Atendido</Badge>;
}

function cuandoLlego(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    // EXPLICIT, ALWAYS. This screen renders on the server and Vercel runs
    // in UTC: without this, an order placed at 8 p.m. in Caracas comes out
    // dated the following day. It is DESIGN-SYSTEM.md's rule, and the defect
    // `CT-81` records on the client's own page, where it is still live.
    timeZone,
  }).format(new Date(iso));
}

export function OrdersList({
  orders,
  timeZone,
}: {
  orders: OrderWithItems[];
  timeZone: string;
}) {
  if (orders.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
        Todavía no te ha llegado ningún pedido por el catálogo. Cuando alguien pida desde tu
        enlace, aparece aquí.
      </p>
    );
  }

  return (
    <>
      {/* TELÉFONO */}
      <div className="flex flex-col gap-3 md:hidden">
        {orders.map((order) => (
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
                {cuandoLlego(order.created_at, timeZone)} ·{" "}
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
              <Importes items={order.items} />
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
            {orders.map((order) => (
              <TableRow key={order.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {order.customer_name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {formatDocumentId(order.customer_document)}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Link href={`/productos/ordenes/${order.id}`} className="block">
                    {cuandoLlego(order.created_at, timeZone)}
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
                    <Importes items={order.items} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
