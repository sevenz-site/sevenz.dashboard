import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { createClient } from "@/lib/supabase/server";
import {
  OrderProductSheet,
  OrderProductRowButton,
} from "@/components/dashboard/order-product-sheet";
import { findOrderClient } from "@/lib/orders/order-client-match";
import { UserRound } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { readOwnerCountry } from "@/lib/owner-country";
import { formatDocumentId, formatReceiptDateTime } from "@/lib/format";
import {
  currencyName,
  formatPriceAmount,
  type PriceCurrency,
} from "@/lib/products/price";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  readOrderProducts,
  totalsByCurrency,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
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

      {/* ── «REGISTRADO: …», SOLO CUANDO YA LO ESTÁ ───────────────────
          Pedido por el dueño el 2026-10-25. Sin él, un pedido terminado y
          uno recién llegado se ven exactamente igual al abrirlos: el botón
          «Registrar pedido» desaparece y nada ocupa su sitio, así que el
          tendero se queda mirando una pantalla que no le dice por qué.

          EL CHIP VA ARRIBA Y NO ABAJO, junto al título, porque contesta la
          primera pregunta que se hace al abrir un pedido —«¿esto ya está
          hecho?»— y no la última.

          `registered_at` Y NO `status`: la fecha es lo que el chip enseña, y
          preguntar por una y dibujar la otra es cómo acaban discrepando. */}
      {pedido.registered_at ? (
        <span className="w-fit rounded-full bg-money-in/10 px-2 py-0.5 text-xs text-money-in">
          Registrado: {fecha(pedido.registered_at)}
        </span>
      ) : null}

      {/* ── «DATOS DEL COMPRADOR» — FRAME `1655:15869` ────────────────
          Leído con `get_design_context` el 2026-10-25, nodo por nodo: una
          tarjeta con su cabecera y el icono de persona, y debajo CINCO filas
          de rótulo a la izquierda y valor a la derecha — nombre, documento,
          teléfono, fecha de pedido y notificaciones.

          ═══════════════════════════════════════════════════════════════
          ESTO ERA LA TARJETA DEL PASO 1/4 Y POR ESO LAS DOS PANTALLAS SE
          LEÍAN COMO UNA

          Aquí vivía `OrderClientCard`: avatar, aviso verde «El cliente ya
          existe en tu cuenta de Sevenz» y botón «Ver ‹nombre›» — que es,
          literalmente, el frame `1652:12752`, o sea el PASO SIGUIENTE. El
          dueño lo reportó el 2026-10-25: *«Nuevo pedido > Selecciono
          "Registrar pedido" > Me muestra nuevamente "Nuevo pedido" (está mal,
          me estás volviendo a mostrar la misma pantalla anterior, en el
          sitemap no está así)»*. Tenía razón y la causa no era el título: era
          que el cuerpo de las dos pantallas era el mismo.

          LAS DOS SIGUEN LLAMÁNDOSE «Nuevo pedido», y eso SÍ está en el
          sitemap: el frame del detalle rotula su H1 «Nuevo pedido» igual que
          el del 1/4. Lo que las distingue es lo que hay debajo — aquí, una
          ficha en frío de quién pidió y cuánto; allí, el contador «1/4», el
          cotejo con la cuenta y un botón «Registrar» por moneda.

          ───────────────────────────────────────────────────────────────
          QUÉ SE PIERDE AQUÍ, DICHO EN VOZ ALTA

          El cotejo contra la cuenta —«ya existe» / «no lo encontramos»— y el
          botón para abrir su cuenta YA NO SALEN EN ESTA PANTALLA. El frame no
          los dibuja y es coherente: esto es el pedido en frío, y la pregunta
          «¿quién es este en mi cuenta?» es del paso 1/4, donde se decide a
          quién se le apunta la deuda. Quien lo necesite antes lo tiene a un
          toque, detrás de «Registrar pedido».

          EL DOCUMENTO LLEVA SU PREFIJO aunque el frame escriba «00.000.000» a
          secas. Es la norma del 2026-10-25, escrita en `DESIGN-SYSTEM.md`
          después de que esto fallara tres veces: «V-21.054.832» y
          «E-21.054.832» son dos personas distintas. */}
      <div className="flex flex-col rounded-[10px] border p-4">
        <div className="flex items-center justify-between pb-2 pt-1">
          <h2 className="text-base font-semibold">Datos del comprador</h2>
          <UserRound className="size-5 shrink-0" aria-hidden="true" />
        </div>
        <Fila nombre="Nombre y apellido">{pedido.customer_name}</Fila>
        <Fila nombre="Documento">
          {pedido.customer_document
            ? formatDocumentId(pedido.customer_document, pedido.customer_document_type)
            : "—"}
        </Fila>
        <Fila nombre="Teléfono">
          {/* EL CRUDO, el que el cliente tecleó, igual que hacía la tarjeta
              que había antes: el normalizado es dígitos pegados y lo usa
              `wa.me`, no un ojo humano comparándolo con una agenda. */}
          {pedido.customer_whatsapp_raw || pedido.customer_whatsapp || "—"}
        </Fila>
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

      {/* SUBTOTALS PER CURRENCY, NEVER ONE FIGURE. The owner's decision 4 of
          2026-10-14: there is no EUR→USD rate in this product, only BCV to
          bolívares, so a single total would be an invented number.

          A HEADING AND A CARD EACH, from frame `1371:7229`. They used to be
          two rows inside the same box as everything else, which read as the
          last two facts of the order rather than as its bottom line -- and
          the bottom line is what the shopkeeper opens this screen to see. */}
      {/* ── LO QUE PIDIÓ, EN FRÍO ──────────────────────────────────────
          El frame del detalle (`1655:15864`) dibuja «Pedido» con una fila por
          producto antes de los totales, y es lo que esta pantalla existe para
          contestar: qué pidió y cuánto es.

          LA FILA ES `OrderProductRowButton`, Y ESO NO ES REUTILIZAR POR
          REUTILIZAR: el frame de la tarjeta (`1655:15893`) dibuja foto de
          40×40, nombre en 16 semibold, «00 x $00.00 · al detal» en 12, la
          bandera de la moneda junto al precio y un chevron. Ese componente es
          exactamente eso, hasta el respaldo cuando no hay foto.

          SE PERDIÓ Y SE REPUSO DOS VECES EL MISMO DÍA. Al separar el `1/4` en
          su propia pantalla se fue con los bloques; lo repuse a mano, con una
          fila plana sin foto, sin bandera y sin chevron, y el dueño lo
          reportó con el frame delante. Escribir de nuevo algo que ya estaba
          escrito es cómo una pantalla deja de parecerse a su diseño sin que
          nadie borre nada.

          EL CHEVRON ABRE LA HOJA DEL PRODUCTO, que es lo que promete: la
          descripción, la foto grande y el stock de hoy. Aquí no hay botones
          que escriban dinero — eso vive en el `1/4`. */}
      {items.length > 0 ? (
        <>
          <h2 className="mt-1 text-xl font-semibold">Pedido</h2>
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const producto = item.product_id
                ? (productosPorId.get(item.product_id) ?? null)
                : null;
              return (
                <OrderProductSheet
                  key={item.id}
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
                    cantidad={Number(item.quantity)}
                    precioUnitario={Number(item.unit_price)}
                    moneda={item.currency as PriceCurrency}
                    escalon={item.tier as PriceTier}
                    fotoPath={producto?.photo_path ?? null}
                  />
                </OrderProductSheet>
              );
            })}
          </div>
        </>
      ) : null}

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

      {/* ── «REGISTRAR PEDIDO», Y VUELVE CON ALGO DETRÁS ──────────────
          El comentario que vivía aquí decía que este botón se había quitado
          el 2026-10-21 porque lo que haría era `CT-70`, sin construir, y que
          *«cuando CT-70 aterrice, el botón vuelve aquí con una acción de
          verdad detrás»*. Aterrizó el 2026-10-25.

          LLEVA AL PASO 1/4 Y NO REGISTRA NADA ÉL MISMO: el sitemap dibuja
          dos pantallas unidas por esta flecha, «Selecciona "Registrar
          pedido"». Lo que se registra vive allí.

          NO SE DIBUJA EN UN PEDIDO YA REGISTRADO: no hay nada que registrar,
          y ofrecerlo llevaría a una pantalla que redirige de vuelta aquí. */}
      {pedido.registered_at == null ? (
        <div className="pt-1">
          <Button className="h-10 w-full" asChild>
            <Link href={`/productos/ordenes/${pedido.id}/registrar`}>
              Registrar pedido
            </Link>
          </Button>
        </div>
      ) : null}

      {/* ── «MARCAR COMO ATENDIDO» YA NO EXISTE ────────────────────────
          Petición del dueño el 2026-10-25, con la captura y el círculo en
          rojo, junto con la barra de navegación. El frame del detalle
          (`1655:15864`) tampoco lo dibuja: esa pantalla termina en «Registrar
          pedido».

          Y AL PREGUNTARLE DÓNDE IBA ESA ACCIÓN --era el único sitio desde el
          que se podía ejecutar-- decidió que no va a ninguna parte:
          *«registrar lo da por atendido»*. `registrarPedidoComoVenta` sella
          `seen` con la primera moneda y `registered` con la última; el botón,
          su diálogo y `markOrderAttended` se borraron. Eso cierra `CT-83` por
          la raíz: aquel aviso existía porque no se podía registrar.

          LO QUE CUESTA, que él eligió sabiéndolo: un pedido atendido pero NO
          registrado --regalado, entregado sin cobrar-- se queda como nuevo
          para siempre. No hay otra puerta. */}
    </div>
  );
}
