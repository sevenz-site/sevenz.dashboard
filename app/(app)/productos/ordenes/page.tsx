import { createClient } from "@/lib/supabase/server";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { OrdersEmpty } from "@/components/dashboard/orders-empty";
import { CatalogShareButton } from "@/components/dashboard/catalog-share";
import { type OrderWithItems } from "@/components/dashboard/orders-list";
import {
  OrdersFilterProvider,
  OrdersSearchField,
  OrdersFilterChips,
  OrdersResults,
  OrdersShareCard,
} from "@/components/dashboard/orders-filters";
import { readOwnerCountry } from "@/lib/owner-country";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  totalsByCurrency,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";

// THE CATALOGUE'S ORDERS. Deliverable D, reading half.
//
// ===========================================================================
// WHY THE DATA EXISTED BEFORE THIS SCREEN DID
//
// The cart has been storing orders since 2026-10-15 and the catalogue reached
// production on 2026-10-16. Between those two dates orders were written to
// `catalog_orders` and **no screen read them**: the shopkeeper only found out
// through the WhatsApp message the customer sends from their own phone.
//
// That works nearly always and fails in one specific way. The owner's
// decision 1 of 2026-10-14 stores the order BEFORE opening WhatsApp precisely
// because *«si el cliente nunca llega a pulsar enviar, que en iOS pasa, el
// pedido existe igual»*. Without this screen, that order exists and nobody can
// read it.
// ===========================================================================

export default async function OrdenesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: orders, error: errorOrders },
    country,
    { data: owner },
    { data: catalogLink },
    { data: publicables, error: errorPublicables },
  ] = await Promise.all([
    supabase
      .from("catalog_orders")
      .select(ORDER_COLUMNS)
      .eq("owner_id", user!.id)
      // ── LOS DESCARTADOS NO SALEN AQUÍ ─────────────────────────────
      //
      // Migración `162`. El dueño lo pidió el 2026-10-26 --*«al seleccionarla
      // elimina el pedido»*-- y el propio diálogo se lo promete: «sale de tu
      // lista de pedidos y deja de contar como pendiente».
      //
      // MEDIDO EN DEV ESE DÍA: sin esta línea el pedido descartado seguía en
      // la lista, con su estado y todo. El diálogo decía una cosa y la
      // pantalla de al lado otra.
      //
      // Y NO SE PIERDE: la notificación roja lo nombra y lleva su
      // «Restaurar». Esconderlo de la lista sin ese aviso sí sería perderlo,
      // y por eso las dos cosas se construyeron juntas.
      .neq("status", "discarded")
      // UNATTENDED FIRST, most recent at the top within each group.
      // Ordering by date alone would bury yesterday's unprepared order under
      // three of today's already dealt with -- the exact opposite of what the
      // shopkeeper needs to see when the screen opens.
      .order("status", { ascending: true })
      .order("created_at", { ascending: false }),
    readOwnerCountry(supabase, user!.id),
    // ── LO QUE EL ESTADO VACÍO NECESITA ──────────────────────────────
    //
    // Su botón «Compartir catálogo» es el MISMO de la cabecera de Catálogo, y
    // ese componente pide tres cosas: el nombre del negocio para el mensaje,
    // el enlace ya servido y cuántos productos hay publicados.
    //
    // EN EL MISMO VIAJE QUE LOS PEDIDOS y no después: son tres consultas
    // diminutas, y encadenarlas detrás de la lista le costaría a esta pantalla
    // una vuelta entera por algo que casi siempre no se va a dibujar.
    //
    // EL ENLACE VIENE SERVIDO, no se crea al pulsar: `navigator.share` tiene
    // que salir del gesto del dedo, y un `await` entre el toque y la hoja es
    // lo que iOS Safari rechaza. Misma razón escrita en `productos/page.tsx`.
    supabase.from("owners").select("business_name").eq("id", user!.id).maybeSingle(),
    supabase.from("catalog_share_links").select("token").eq("owner_id", user!.id).maybeSingle(),
    supabase
      .from("products")
      .select("published_retail, published_wholesale")
      .eq("owner_id", user!.id)
      // `trashed_at` Y NO `deleted_at`: esa columna NO EXISTE en `products`.
      //
      // Con ella, PostgREST devolvía `42703: column products.deleted_at does
      // not exist`, `publicables` llegaba `null`, y el contador caía a cero —
      // así que «Compartir» contestaba «Todavía no has publicado ningún
      // producto» a un negocio que sí tenía. Lo reportó el dueño el
      // 2026-10-20 con la captura del aviso encima de su lista de pedidos.
      //
      // La pantalla de Catálogo filtra bien desde siempre; esta consulta nació
      // aquí copiando la forma, no el nombre. La papelera de productos es
      // `trashed_at` porque un producto se tira a la papelera y se recupera,
      // que es otra cosa que borrarlo.
      .is("trashed_at", null),
  ]);

  // ── UNA LECTURA FALLIDA NO ES UNA TIENDA VACÍA ──────────────────────
  //
  // Es la MISMA lección que esta pantalla ya tenía escrita quince líneas más
  // abajo para los pedidos, y que esta consulta no aplicó: con el error
  // descartado, un fallo de lectura se presentaba como «no has publicado
  // nada», que es una frase sobre el negocio y no sobre la consulta.
  //
  // Ahora se registra, y el contador se queda en cero igual --no hay nada
  // mejor que contar-- pero el log dice qué pasó en vez de dejar al dueño
  // buscando un producto que ya había publicado.
  if (errorPublicables) console.error("[orders] publicables:", errorPublicables.message);

  // Las tres cifras que el botón distingue: sin NINGUNA publicada avisa en vez
  // de compartir una página que diría «este negocio no tiene productos».
  const filasPublicables = (publicables ?? []) as {
    published_retail: boolean;
    published_wholesale: boolean;
  }[];
  const publishedCount = {
    retail: filasPublicables.filter((p) => p.published_retail).length,
    wholesale: filasPublicables.filter((p) => p.published_wholesale).length,
    any: filasPublicables.filter((p) => p.published_retail || p.published_wholesale).length,
  };

  // A FAILED READ IS NOT AN EMPTY SHOP, and until 2026-10-16 this screen said
  // it was. Migration 108 created these tables with RLS on and no grant for
  // `authenticated`, so every read came back `42501: permission denied` --
  // and because the error was discarded, the shopkeeper was shown "todavía no
  // te ha llegado ningún pedido" while three orders sat in the database with
  // their customers' names and phone numbers. Migration 116 fixed the grant;
  // this branch is what makes the next failure of any kind say so out loud
  // instead of impersonating good news.
  if (errorOrders) console.error("[orders] list:", errorOrders.message);

  const rows = (orders ?? []) as CatalogOrderRow[];

  // THE LINES, IN ONE ROUND TRIP. A query per order would be N+1 on a screen
  // the shopkeeper opens several times a day.
  let items: CatalogOrderItemRow[] = [];
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("catalog_order_items")
      .select(ORDER_ITEM_COLUMNS)
      // SOLO LAS VIVAS -- migración `161`. Una moneda que el tendero quitó no
      // cuenta en los totales de la lista: si contara, un pedido del que solo
      // va a cobrar los dólares seguiría anunciando sus euros.
      .is("deleted_at", null)
      .in(
        "order_id",
        rows.map((o) => o.id),
      );
    if (error) console.error("[orders] list items:", error.message);
    items = (data ?? []) as CatalogOrderItemRow[];
  }

  const porPedido = new Map<string, CatalogOrderItemRow[]>();
  for (const item of items) {
    const lista = porPedido.get(item.order_id);
    if (lista) lista.push(item);
    else porPedido.set(item.order_id, [item]);
  }

  // THE SHOP'S ZONE, never the server's: this page renders on Vercel, which
  // runs in UTC.
  const zona = country === "VE" ? "America/Caracas" : "America/Bogota";
  const cuandoLlego = (iso: string) =>
    new Intl.DateTimeFormat("es-VE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zona,
    }).format(new Date(iso));

  // DATES AND AMOUNTS ARE WRITTEN OUT HERE, not in the list. The list became a
  // client component when the search and the chip went in, and `Intl` run
  // twice -- once in Node for the HTML, once in the browser for the hydration
  // -- does not produce the same characters: Node writes "7:34 p." + U+00A0 +
  // "m." and the browser writes a different space, which React reports as a
  // hydration mismatch and repairs by re-rendering the whole list. Formatting
  // on the server leaves the list with no `Intl` at all.
  const conLineas: OrderWithItems[] = rows.map((o) => {
    const items = porPedido.get(o.id) ?? [];
    return {
      ...o,
      items,
      llegoEl: cuandoLlego(o.created_at),
      importes: totalsByCurrency(items).map((t) => ({
        currency: t.currency,
        texto: formatPriceAmount(t.amount, t.currency as PriceCurrency),
      })),
    };
  });

  const sinAtender = rows.filter((o) => o.status === "new").length;

  return (
    // The provider wraps the header AND the list: the field and the chip are
    // painted inside `ScreenHeader`, which is a sibling of the list, and two
    // siblings share no state without something above them. Same shape as
    // Catálogo's `CatalogFilterProvider`.
    <OrdersFilterProvider orders={conLineas}>
      <div className="flex flex-col gap-4">
        <ScreenHeader
          title="Pedidos"
          // A CATÁLOGO, NO A INICIO: a Pedidos se entra desde ahí. Lo reportó
          // el dueño el 2026-10-20 --la flecha lo sacaba al Inicio-- y es la
          // única de las seis pantallas con cabecera oscura que no cuelga
          // directamente del Inicio.
          backHref="/productos"
          backLabel="Volver a Catálogo"
          // THE SUBTITLE COUNTS EVERYTHING, not what the filter leaves on
          // screen. "2 sin registrar" is the state of the business; the list
          // below is a view of it. Making this follow the chip would mean the
          // number drops to zero when the owner filters by "Registrado", which
          // reads as "there is nothing left to do".
          subtitle={
            sinAtender > 0
              ? `${sinAtender} sin registrar`
              : "Lo que te piden desde tu enlace de catálogo"
          }
          search={<OrdersSearchField />}
          filters={<OrdersFilterChips />}
        />
        <h2 className="mt-1 text-xl font-semibold">Pedidos recibidos</h2>

        {/* LA TARJETA DE COMPARTIR, encima de la lista y solo cuando ya hay
            pedidos. `OrdersShareCard` pone la condición --ver su comentario--
            y aquí se monta lo que necesita datos del servidor. */}
        <OrdersShareCard>
          <CatalogShareButton
            publishedCount={publishedCount}
            businessName={owner?.business_name || "mi negocio"}
            initialToken={catalogLink?.token ?? null}
            variante="tarjeta"
          />
        </OrdersShareCard>
        {errorOrders ? (
          // The real reason is in the server log and stays there. What the
          // shopkeeper needs is to know that the screen could not answer, so
          // they do not read silence as "nobody ordered".
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No pudimos cargar tus pedidos ahora mismo. Vuelve a intentarlo en un momento.
          </p>
        ) : (
          <OrdersResults
            vacio={
              <OrdersEmpty
                publishedCount={publishedCount}
                businessName={owner?.business_name || "mi negocio"}
                initialToken={catalogLink?.token ?? null}
              />
            }
          />
        )}
      </div>
    </OrdersFilterProvider>
  );
}
