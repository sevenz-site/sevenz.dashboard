import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OrderAttendButton } from "@/components/dashboard/order-attend-button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { readOwnerCountry } from "@/lib/owner-country";
import { formatDocumentId } from "@/lib/format";
import { currencyName, formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  isUnattended,
  totalsByCurrency,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";

// ONE ORDER'S PAGE. Deliverable D, reading half.
//
// THE CUSTOMER'S DETAILS ARE SHOWN AND NOT YET EDITABLE. The plan wants them
// editable -- it is the double check the owner decided on 2026-10-15 -- but
// correcting the phone moves the WhatsApp consent, which is keyed by number
// and not by client, and that decision is `CT-69` and still open. Showing them
// already does what the shopkeeper needs today: know who to call.

function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{nombre}</span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
    </div>
  );
}

export default async function OrdenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `.eq("owner_id", user.id)` EXPLICITLY. The id arrives from the URL, so
  // this is not convenience: without it, changing the identifier in the
  // address bar would show another business's order -- a real person's
  // details, with their document number. The RLS policy is the backstop.
  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  // A read that FAILED and an order that does not exist both leave `order`
  // null, and a 404 is the right answer only to the second one. The first is
  // why this log exists: on 2026-10-16 every read of this table came back
  // `42501` for want of a grant (migration 116), and with the error dropped
  // the screen would have claimed the order was gone.
  if (error) console.error("[orders] detail:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  const [{ data: itemRows, error: errorItems }, country] = await Promise.all([
    supabase
      .from("catalog_order_items")
      .select(ORDER_ITEM_COLUMNS)
      .eq("order_id", pedido.id)
      .order("product_name", { ascending: true }),
    readOwnerCountry(supabase, user!.id),
  ]);

  if (errorItems) console.error("[orders] detail items:", errorItems.message);

  const items = (itemRows ?? []) as CatalogOrderItemRow[];
  const totales = totalsByCurrency(items);

  // The owner's zone, never the server's: this page renders on Vercel, which
  // runs in UTC.
  const zona = country === "VE" ? "America/Caracas" : "America/Bogota";
  const cuando = new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: zona,
  }).format(new Date(pedido.created_at));

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/productos/ordenes"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Pedidos
      </Link>

      <h1 className="text-2xl font-semibold">{pedido.customer_name}</h1>

      <h2 className="mt-1 text-xl font-semibold">Quién pidió</h2>
      <div className="rounded-lg border bg-muted/30 px-3 py-2">
        <Fila nombre="Nombre">{pedido.customer_name}</Fila>
        <Fila nombre="Documento">{formatDocumentId(pedido.customer_document)}</Fila>
        {/* THE RAW ONE, NOT THE NORMALISED ONE: it is what the person
            typed, and what the shopkeeper needs in order to judge whether it
            is right. The normalised one is the key the database stores it
            under, not something to show anybody. */}
        <Fila nombre="WhatsApp">{pedido.customer_whatsapp_raw || "—"}</Fila>
        <Fila nombre="Llegó">{cuando}</Fila>
        {/* "Notificaciones" and not "Avisos", "Aceptada" and not "Los
            aceptó": the owner's wording, 2026-10-16. */}
        <Fila nombre="Notificaciones por WhatsApp">
          {pedido.wants_whatsapp_notices ? "Aceptada" : "Sin aceptar"}
        </Fila>
      </div>

      <h2 className="mt-1 text-xl font-semibold">Qué pidió</h2>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Este pedido no tiene líneas.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{item.product_name}</span>
                {/* THE FLAG BESIDE THE AMOUNT, owner's request of
                    2026-10-16. USDT prints no symbol of its own, so without
                    it a USDT line is a bare number sitting next to lines that
                    carry a `$` or a `€`. */}
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
                  <CurrencyFlagIcon currency={item.currency as PriceCurrency} />
                  {formatPriceAmount(
                    Number(item.quantity) * Number(item.unit_price),
                    item.currency as PriceCurrency,
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {Number(item.quantity)} ×{" "}
                {formatPriceAmount(Number(item.unit_price), item.currency as PriceCurrency)}
                {/* THE TIER, said out loud. Without it a cheap line looks
                    the same as an invented discount: with it, the shopkeeper
                    sees it was the wholesale price because they ordered six. */}
                {" · "}
                {item.tier === "wholesale" ? "al mayor" : "al detal"}
              </p>
              {item.comment ? (
                <p className="mt-1 rounded border bg-background px-2 py-1 text-xs">
                  {item.comment}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>

      {/* SUBTOTALS PER CURRENCY, NEVER ONE FIGURE. The owner's decision 4 of
          2026-10-14: there is no EUR→USD rate in this product, only BCV to
          bolívares, so a single total would be an invented number. */}
      {totales.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          {totales.map((t) => (
            // THE CURRENCY IS ALWAYS NAMED, even when the order carries a
            // single one -- the owner's request of 2026-10-16. It used to say
            // a bare "Total" for one currency, which is only unambiguous to
            // somebody who has just read the lines above it; "Total en
            // dólares" answers it on its own, and in words rather than the
            // ISO code, which is bank vocabulary.
            <Fila key={t.currency} nombre={`Total en ${currencyName(t.currency as PriceCurrency)}`}>
              <span className="flex items-center justify-end gap-1.5 tabular-nums">
                <CurrencyFlagIcon currency={t.currency as PriceCurrency} />
                {formatPriceAmount(t.amount, t.currency as PriceCurrency)}
              </span>
            </Fila>
          ))}
        </div>
      ) : null}

      <div className="pt-1">
        <OrderAttendButton orderId={pedido.id} atendido={!isUnattended(pedido)} />
      </div>
    </div>
  );
}
