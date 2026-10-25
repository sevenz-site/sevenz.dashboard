import { notFound } from "next/navigation";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { createClient } from "@/lib/supabase/server";
import { OrderAttendButton } from "@/components/dashboard/order-attend-button";
import { OrderClientCard } from "@/components/dashboard/order-client-card";
import { findOrderClient } from "@/lib/orders/order-client-match";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { readOwnerCountry } from "@/lib/owner-country";
import { formatReceiptDateTime } from "@/lib/format";
import {
  currencyName,
  formatPriceAmount,
  type PriceCurrency,
} from "@/lib/products/price";
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
import { OrderProductSheet } from "@/components/dashboard/order-product-sheet";
import {
  OrderRegistrationSummary,
  type LineaDelPedido,
} from "@/components/dashboard/order-registration-summary";
import { OrderContinueButton } from "@/components/dashboard/order-continue-button";
import {
  OrderProductCard,
  OrderProductRowButton,
} from "@/components/dashboard/order-product-card";
import type { BolivarRates, PriceTier } from "@/lib/products/price";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

// ONE ORDER'S PAGE. Deliverable D, reading half.
//
// THE CUSTOMER'S DETAILS ARE SHOWN AND NOT YET EDITABLE. The plan wants them
// editable -- it is the double check the owner decided on 2026-10-15 -- but
// correcting the phone moves the WhatsApp consent, which is keyed by number
// and not by client, and that decision is `CT-69` and still open. Showing them
// already does what the shopkeeper needs today: know who to call.

function Fila({
  nombre,
  children,
}: {
  nombre: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{nombre}</span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
    </div>
  );
}

export default async function OrdenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const [{ data: itemRows, error: errorItems }, country, clienteDelPedido] =
    await Promise.all([
      supabase
        .from("catalog_order_items")
        .select(ORDER_ITEM_COLUMNS)
        .eq("order_id", pedido.id)
        .order("product_name", { ascending: true }),
      readOwnerCountry(supabase, user!.id),
      // WHETHER THIS SHOP ALREADY HAS THIS CUSTOMER. Matched by document, the
      // owner's decision of 2026-10-24 -- see `findOrderClient` for why not by
      // phone and not by name. It goes in the same batch and not after it: the
      // card at the top of the screen cannot be drawn without the answer.
      findOrderClient(
        supabase,
        user!.id,
        pedido.customer_document,
        pedido.customer_document_type,
      ),
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

  // THE LINES AS THE DRAFT SEES THEM: id, quantity, unit price and currency.
  // The draft lives in the browser, so the per-currency roll-up is computed
  // there; what the server owes it is the sealed half of each line.
  const lineasParaResumen: LineaDelPedido[] = items.map((i) => ({
    id: i.id,
    cantidad: Number(i.quantity),
    precioUnitario: Number(i.unit_price),
    moneda: i.currency as PriceCurrency,
  }));

  // WHAT THIS CUSTOMER ALREADY OWED, for the «Deuda antigua» row.
  //
  // ONLY WHEN EXACTLY ONE FICHA MATCHED. With several, nothing in the order
  // tells them apart — see `findOrderClient` — so showing one person's debt
  // would be a coin flip on whose it is, printed as a fact. With none, there
  // is no debt to show. Both cases leave this empty and the row reads zero.
  const deudaAntigua: Partial<Record<PriceCurrency, number>> = {};
  if (clienteDelPedido.kind === "uno") {
    const { data: saldo } = await supabase
      .from("client_summary")
      .select("balance, balance_usd, balance_eur")
      .eq("client_id", clienteDelPedido.cliente.id)
      .eq("owner_id", user!.id)
      .maybeSingle();
    if (saldo) {
      if (saldo.balance_usd != null)
        deudaAntigua.USD = Number(saldo.balance_usd);
      if (saldo.balance_eur != null)
        deudaAntigua.EUR = Number(saldo.balance_eur);
      // `balance` IS THE COLOMBIAN LEDGER, the one whose `movements.currency`
      // is null. Filing it under COP is what the rest of the app already does
      // when it has to name that ledger on screen.
      if (saldo.balance != null) deudaAntigua.COP = Number(saldo.balance);
    }
  }

  // The owner's zone, never the server's: this page renders on Vercel, which
  // runs in UTC. It lived here as its own `Intl.DateTimeFormat` until
  // 2026-10-22, when the receipts of the other flows needed the same clock;
  // it now comes from `formatReceiptDateTime`, so there is one of them.
  const fecha = (iso: string) => formatReceiptDateTime(iso, country);

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
      {/* `soloEnTelefono={false}` porque esta pantalla nunca tuvo el
          `sm:hidden` de las otras tres: su flecha se ve a todas las anchuras. */}
      <ScreenBackRow
        href="/productos/ordenes"
        label="Volver a Pedidos"
        soloEnTelefono={false}
      />

      {/* «Nuevo pedido» Y NO EL NOMBRE DEL CLIENTE — frame `1518:10873`, y
          el dueño renombró la página de Figma así el 2026-10-24.

          QUÉ SE PIERDE Y POR QUÉ SE PUEDE PERDER: el título decía de quién
          era el pedido. Ahora lo dice la tarjeta de debajo, con su nombre, su
          cédula, su teléfono y su dirección — más de lo que cabía en un
          título, y a dos centímetros. */}
      <ScreenTitle>Nuevo pedido</ScreenTitle>

      {/* QUIÉN PIDIÓ, Y SI YA ESTÁ EN LA CUENTA — frames `1518:10879` y
          `1514:10294`. Sustituye a la lista de filas «Nombre / Documento /
          WhatsApp» que había aquí: las mismas cuatro cosas, más la única que
          el tendero no podía saber sin ir a buscarla. */}
      <OrderClientCard
        nombreDelPedido={pedido.customer_name}
        documentoDelPedido={pedido.customer_document}
        tipoDeDocumento={pedido.customer_document_type}
        telefono={pedido.customer_whatsapp_raw || ""}
        coincidencia={clienteDelPedido}
      />

      {/* LAS DOS FILAS QUE NO SON DEL CLIENTE SINO DEL PEDIDO, y por eso
          quedan fuera de su tarjeta — frame `1518:10873`, que las dibuja
          debajo. La fecha es cuándo pidió; el permiso es de este pedido. */}
      <div className="flex flex-col rounded-[10px] border px-4 py-1">
        <Fila nombre="Fecha del pedido:">{cuando}</Fila>
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

      {/* SUBTOTALS PER CURRENCY, NEVER ONE FIGURE. The owner's decision 4 of
          2026-10-14: there is no EUR→USD rate in this product, only BCV to
          bolívares, so a single total would be an invented number.

          A HEADING AND A CARD EACH, from frame `1371:7229`. They used to be
          two rows inside the same box as everything else, which read as the
          last two facts of the order rather than as its bottom line -- and
          the bottom line is what the shopkeeper opens this screen to see. */}
      {totales.length > 0 ? (
        <>
          {/* «TOTAL POR PAGAR», which is what BOTH frames write --
              `1518:10873` and `1564:11979`. It said «Totales» until
              2026-10-24; the difference is not cosmetic, because «Totales» is
              a heading over a sum and this one names what the money is FOR. */}
          <h2 className="mt-1 text-xl font-semibold">Total por pagar</h2>
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
              <div
                key={t.currency}
                className="flex flex-col gap-1.5 rounded-[10px] border px-4 py-2"
              >
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
                    {/* «Hoy», como lo escriben los frames: el total está
                        cerrado y su valor en bolívares no. */}
                    {formatPriceAmount(t.amount * bsPorUnidad, "VES")} Hoy
                  </span>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}

      <h2 className="mt-1 text-xl font-semibold">Pedido</h2>
      <div className="flex flex-col gap-2">
        {/* WHAT THIS ORDER WOULD BECOME, once something has been registered.
            It draws nothing until then, which is the difference between the
            two frames of this screen. */}
        <OrderRegistrationSummary
          pedidoId={pedido.id}
          lineas={lineasParaResumen}
          deudaAntigua={deudaAntigua}
          rates={rates}
        />
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Este pedido no tiene líneas.
          </p>
        ) : (
          items.map((item) =>
            // CADA LÍNEA ABRE SU PRODUCTO. Frame `1371:7229`: miniatura,
            // nombre, cantidad por precio y escalón, el total con su bandera
            // y un chevron que dice que hay algo detrás.
            //
            // EL COMENTARIO SE QUEDA FUERA DE LA FILA y se lee dentro. Antes
            // vivía aquí debajo y podía ser un párrafo entero: con la fila
            // ahora tocable, un bloque de texto dentro del botón convierte
            // una lista de dos renglones en una pared.
            (() => {
              // EL PRODUCTO SE RESUELVE UNA VEZ Y LO LEEN LAS TRES PIEZAS.
              // `product_id` es `on delete set null`, así que una línea puede
              // quedarse sin producto; y `readOrderProducts` devuelve un mapa
              // vacío cuando la lectura FALLA, que no es lo mismo que
              // «borrado» -- por eso el mapa se consulta una vez y no tres.
              const producto = item.product_id
                ? (productosPorId.get(item.product_id) ?? null)
                : null;
              return (
                <OrderProductCard
                  key={item.id}
                  cantidad={Number(item.quantity)}
                  precioUnitario={Number(item.unit_price)}
                  moneda={item.currency as PriceCurrency}
                  escalon={item.tier as PriceTier}
                  productoBorrado={producto == null}
                  hrefEditar={
                    producto
                      ? `/productos/ordenes/${pedido.id}/registrar/${item.id}/editar`
                      : null
                  }
                  hrefRegistrar={`/productos/ordenes/${pedido.id}/registrar/${item.id}`}
                  rates={rates}
                >
                  <OrderProductSheet
                    nombreEnElPedido={item.product_name}
                    cantidad={Number(item.quantity)}
                    precioUnitario={Number(item.unit_price)}
                    moneda={item.currency as PriceCurrency}
                    escalon={item.tier as PriceTier}
                    comentario={item.comment}
                    producto={producto}
                    rates={rates}
                  >
                    <OrderProductRowButton
                      nombre={item.product_name}
                      fotoPath={producto?.photo_path ?? null}
                    />
                  </OrderProductSheet>
                </OrderProductCard>
              );
            })(),
          )
        )}
      </div>

      {/* «CONTINUAR», which draws nothing until at least one line is
          registered — the owner's rule of 2026-10-24, and the whole
          difference between this screen's two frames.

          WHERE IT GOES DEPENDS ON THE CLIENT. One ficha matched: straight to
          confirming it (`1614:11782`). None, or several: the client's details
          have to be filled in (`1564:11876`). The page decides because only
          the page knows which, and `findOrderClient` already answered it for
          the card at the top. */}
      <OrderContinueButton
        pedidoId={pedido.id}
        lineas={lineasParaResumen}
        href={
          clienteDelPedido.kind === "uno"
            ? `/productos/ordenes/${pedido.id}/registrar/cliente?ficha=${clienteDelPedido.cliente.id}`
            : `/productos/ordenes/${pedido.id}/registrar/cliente`
        }
      />

      {/* «REGISTRAR PEDIDO» IS NOT HERE, AND THAT IS THE DECISION, NOT AN
          OVERSIGHT.

          The frame `1371:7229` draws it, and it shipped disabled on
          2026-10-17 with the sentence «llega en la próxima entrega»
          underneath. The owner removed both on 2026-10-21, for launch A:
          what the button would do is `CT-70`, which is blocked on three of
          his own decisions and is not built. A disabled control that
          promises a date is a promise this release cannot keep, and it sits
          directly above the one action the screen can actually perform.

          SO THE SCREEN NOW ENDS AT «MARCAR COMO ATENDIDO», which is all it
          has ever been able to do. When `CT-70` lands, the button comes back
          here with a real action behind it -- never enabled against
          `OrderAttendButton`, because marking an order attended is a
          different thing from registering it as a sale, and wiring one to
          the other would be lying in the owner's own words. `CT-92` tracked
          this and closes with its removal. */}
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
