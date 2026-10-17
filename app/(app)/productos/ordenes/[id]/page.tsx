import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { OrderAttendButton } from "@/components/dashboard/order-attend-button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { readOwnerCountry } from "@/lib/owner-country";
import { formatDocumentId } from "@/lib/format";
import { currencyName, formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  isUnattended,
  readOrderProducts,
  totalsByCurrency,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import {
  OrderProductDialog,
  OrderProductRowButton,
} from "@/components/dashboard/order-product-dialog";
import type { BolivarRates, PriceTier } from "@/lib/products/price";

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

  // EL CATÁLOGO DE HOY PARA CADA LÍNEA, y las tasas para los equivalentes en
  // bolívares. Decisión del dueño del 2026-10-17 al mirar el frame
  // `1371:7229`: lo sellado es la línea del pedido, el producto es el de hoy
  // -- un inventario o un costo congelados no ayudan a decidir si se atiende.
  //
  // Las dos en el mismo viaje, y no al abrir el diálogo: el detalle ya está
  // montado, así que pedirlo al tocar pondría una espera justo donde se
  // espera una respuesta inmediata.
  const [productosPorId, rateContext] = await Promise.all([
    readOrderProducts(supabase, user!.id, items),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // Un negocio colombiano no tiene Bs/COP y no convierte nada: sin tasas, el
  // diálogo enseña el precio de su escalón y ya. Ver la cabecera de
  // lib/products/price.ts.
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  // Digits only. The column is already normalised, so this only guards against
  // anything that reached the table by another door than the cart.
  const whatsappDigits = (pedido.customer_whatsapp ?? "").replace(/\D/g, "");

  // «Hola Pedro, sobre tu pedido...» -- the first word of the name, trimmed,
  // and the whole name when there is only one word.
  const primerNombre = pedido.customer_name.trim().split(/\s+/)[0];
  const mensajeWhatsapp = `Hola ${primerNombre}, sobre tu pedido...`;
  const totales = totalsByCurrency(items);

  // The owner's zone, never the server's: this page renders on Vercel, which
  // runs in UTC.
  const zona = country === "VE" ? "America/Caracas" : "America/Bogota";
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-VE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zona,
    }).format(new Date(iso));

  const cuando = fecha(pedido.created_at);

  // WHEN IT WAS ATTENDED, FORMATTED HERE AND NOT IN THE BUTTON. The button is
  // a client component, and `Intl` with no `timeZone` there would use the
  // phone's zone -- the owner's, usually, but not when they are travelling or
  // their device is set to another country. This page already knows the
  // business's zone and the line above it ("Fecha de pedido") is printed with
  // it, so the two dates on the screen are read in the same clock.
  //
  // It can be null with the order already out of 'new': `registered` and
  // `discarded` are set by buttons that do not exist yet (`CT-70`), and
  // nothing forces them to stamp `seen_at`. The sentence then drops the date
  // instead of printing "Invalid Date".
  const atendidoEl = pedido.seen_at ? fecha(pedido.seen_at) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* THE SAME BACK BAR AS NOTIFICACIONES, at the owner's request on
          2026-10-16: he put the two headers side by side and this screen was
          the odd one. Flush to the top and edge to edge -- the negative
          margins cancel `main`'s `p-4` -- with the chevron alone and a rule
          under it. `/import`, `/profile` and `/notificaciones` carry the
          identical row.

          WITHOUT THEIR `sm:hidden`, AND THAT IS THE ONE DIFFERENCE. Those
          three hide it from `sm` up because the app header comes back and
          would be a second bar. It does not come back here: `app-header.tsx`
          lists `/productos` under `bringsItsOwnDarkHeader`, which is every
          width and not just the phone. Copying the `sm:hidden` would leave
          this screen with no way back on a laptop -- and `/productos/ordenes`
          is not in the sidebar, so it would take two clicks through
          Catálogo. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/productos/ordenes" aria-label="Volver a Pedidos">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl font-semibold">{pedido.customer_name}</h1>

      <h2 className="mt-1 text-xl font-semibold">Datos del cliente</h2>
      <div className="rounded-lg border bg-muted/30 px-3 py-2">
        <Fila nombre="Nombre">{pedido.customer_name}</Fila>
        <Fila nombre="Documento">{formatDocumentId(pedido.customer_document)}</Fila>
        {/* THE RAW ONE, NOT THE NORMALISED ONE: it is what the person
            typed, and what the shopkeeper needs in order to judge whether it
            is right. The normalised one is the key the database stores it
            under, not something to show anybody. */}
        <Fila nombre="WhatsApp">{pedido.customer_whatsapp_raw || "—"}</Fila>
        <Fila nombre="Fecha de pedido">{cuando}</Fila>
        {/* "Notificaciones" and not "Avisos", "Aceptada" and not "Los
            aceptó": the owner's wording, 2026-10-16. */}
        <Fila nombre="Notificaciones por WhatsApp">
          {pedido.wants_whatsapp_notices ? "Aceptada" : "Sin aceptar"}
        </Fila>
      </div>

      {/* CONTACTAR, right under "Datos del cliente" -- the owner's placement,
          2026-10-16. It is the action that section leads to: the shopkeeper
          reads who ordered and the next thing they do is ring them.

          IT DIALS `customer_whatsapp`, THE NORMALISED ONE, and not the raw
          number shown above it. The raw string is what the customer typed and
          may carry spaces, dashes or a leading zero, none of which `wa.me`
          accepts; the normalised column is digits only and carries the dial
          code the cart's own `WhatsappInput` composed (migration 109 stores
          it through `normalize_whatsapp_phone`).

          IT OPENS WITH A SENTENCE ALREADY TYPED, the owner's own on
          2026-10-16: «Hola [nombre], sobre tu pedido...». It stops where the
          shopkeeper has to take over on purpose -- what comes next ("ya está
          listo", "no tengo la harina", a price) changes every time and is
          their call. The greeting is the part that is the same every time and
          the part that is tedious to type on a phone.

          THE FIRST NAME ONLY, not the whole thing: an order carries the name
          as the customer typed it to be identified, so it is often "Pedro
          Ramírez" or worse, and «Hola Pedro Ramírez» reads like a bank. If
          the field holds a single word, that word is the greeting.

          NOTHING IS GUESSED WHEN THE NUMBER LOOKS LOCAL. An order stored
          without its country code (ten digits, no 58 or 57) opens the wrong
          chat, and this does not quietly prepend anything to fix it: adding a
          code we were not given is inventing a stranger's phone number. The
          cart always composes one, so a real order has it; the raw number
          sits two lines above for the shopkeeper to compare. */}
      {whatsappDigits ? (
        <a
          href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(mensajeWhatsapp)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          Contactar vía WhatsApp
          {/* The icon goes AFTER the text, like the client's own button and
              the one on `/s/[token]`: the same deal seen from both sides, and
              mirroring them read as two different things. */}
          <WhatsappIcon className="size-4" />
        </a>
      ) : null}

      <h2 className="mt-1 text-xl font-semibold">Pedido</h2>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Este pedido no tiene líneas.
          </p>
        ) : (
          items.map((item) => (
            // CADA LÍNEA ABRE SU PRODUCTO. Frame `1371:7229`: miniatura,
            // nombre, cantidad por precio y escalón, el total con su bandera
            // y un chevron que dice que hay algo detrás.
            //
            // EL COMENTARIO SE QUEDA FUERA DE LA FILA y se lee dentro. Antes
            // vivía aquí debajo y podía ser un párrafo entero: con la fila
            // ahora tocable, un bloque de texto dentro del botón convierte
            // una lista de dos renglones en una pared.
            <OrderProductDialog
              key={item.id}
              nombreEnElPedido={item.product_name}
              cantidad={Number(item.quantity)}
              precioUnitario={Number(item.unit_price)}
              moneda={item.currency as PriceCurrency}
              escalon={item.tier as PriceTier}
              comentario={item.comment}
              producto={item.product_id ? (productosPorId.get(item.product_id) ?? null) : null}
              rates={rates}
            >
              <OrderProductRowButton
                nombre={item.product_name}
                cantidad={Number(item.quantity)}
                precioUnitario={Number(item.unit_price)}
                moneda={item.currency as PriceCurrency}
                escalon={item.tier as PriceTier}
                fotoPath={
                  item.product_id
                    ? (productosPorId.get(item.product_id)?.photo_path ?? null)
                    : null
                }
              />
            </OrderProductDialog>
          ))
        )}
      </div>

      {/* SUBTOTALS PER CURRENCY, NEVER ONE FIGURE. The owner's decision 4 of
          2026-10-14: there is no EUR→USD rate in this product, only BCV to
          bolívares, so a single total would be an invented number.

          A HEADING AND A CARD EACH, from frame `1371:7229`. They used to be
          two rows inside the same box as everything else, which read as the
          last two facts of the order rather than as its bottom line -- and
          the bottom line is what the shopkeeper opens this screen to see. */}
      {totales.length > 0 ? (
        <>
          <h2 className="mt-1 text-xl font-semibold">Totales</h2>
          {totales.map((t) => {
            const moneda = t.currency as PriceCurrency;
            // EL EQUIVALENTE EN BOLÍVARES ES EL DE HOY, y por eso no se
            // sella: el total está cerrado, lo que vale en bolívares cambia
            // cada día. Un negocio colombiano no tiene tasa y no lo enseña.
            const bsPorUnidad =
              rates == null
                ? null
                : moneda === "USD"
                  ? rates.usd
                  : moneda === "EUR"
                    ? rates.eur
                    : moneda === "USDT"
                      ? rates.usdt
                      : null;
            return (
              <div key={t.currency} className="flex flex-col gap-1.5 rounded-[10px] border px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {/* LA MONEDA SIEMPRE NOMBRADA, aunque el pedido traiga
                        una sola -- petición del dueño del 2026-10-16. Un
                        «Total» a secas solo es inequívoco para quien acaba
                        de leer las líneas de arriba. */}
                    <span className="text-xs font-medium">
                      Total en {currencyName(moneda)}
                    </span>
                    <span className="text-2xl font-semibold text-money-in tabular-nums">
                      {formatPriceAmount(t.amount, moneda)}
                    </span>
                  </div>
                  {/* CON MAYÚSCULA, como en el frame. `currencyName`
                      devuelve minúscula porque está escrita para ir dentro de
                      una frase --«Total en dólares»-- y aquí la palabra va
                      sola, que en español se escribe como un rótulo. */}
                  <span className="flex shrink-0 items-center gap-1 text-xs capitalize">
                    {currencyName(moneda)}
                    <CurrencyFlagIcon currency={moneda} />
                  </span>
                </div>
                {bsPorUnidad != null ? (
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    = {formatPriceAmount(t.amount * bsPorUnidad, "VES")}
                  </span>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}

      {/* «REGISTRAR PEDIDO», DEL FRAME `1371:7229`, Y DESHABILITADO A
          PROPÓSITO. Decisión del dueño el 2026-10-17: la pantalla se lanza
          cuando el paso 10 esté listo, así que el botón entra ya con su
          texto definitivo -- pero lo que registra una orden como fiado o de
          contado es `CT-70`, que está bloqueado por tres decisiones suyas y
          todavía no existe.

          HABILITARLO CON LA ACCIÓN DE HOY DETRÁS HABRÍA SIDO MENTIR: diría
          «registrar pedido» y marcaría como atendido, que es otra cosa. Y
          quitar «Marcar como atendido» mientras tanto le habría quitado a
          esta pantalla lo único que hoy sabe hacer. Anotado en `CT-92` por
          si se lanza antes de tiempo. */}
      <div className="pt-1">
        <Button type="button" className="w-full" disabled>
          Registrar pedido
        </Button>
        <p className="pt-1.5 text-center text-xs text-muted-foreground">
          Registrar el pedido como fiado o de contado llega en la próxima
          entrega.
        </p>
      </div>

      <div className="pt-1">
        <OrderAttendButton
          orderId={pedido.id}
          atendido={!isUnattended(pedido)}
          atendidoEl={atendidoEl}
        />
      </div>
    </div>
  );
}
