import { notFound, redirect } from "next/navigation";
import { OrderClientStep } from "@/components/dashboard/order-client-step";
import { createClient } from "@/lib/supabase/server";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import {
  findOrderClient,
  partirDocumento,
} from "@/lib/orders/order-client-match";
import {
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  type CatalogOrderItemRow,
  type CatalogOrderRow,
} from "@/lib/orders/catalog-orders";
import { bloquesDeMoneda } from "@/lib/orders/bloques-de-moneda";
import { unicaMonedaDelPedido } from "@/lib/orders/pasos-del-registro";

// WHO THE SALE GOES TO — step `4/4`, where «Pagar $00.00» lands.
//
// LA ÚNICA PUERTA DESDE EL 2026-10-25. Hasta ese día había una segunda, el
// «Continuar» del pie del 1/4, y daba vueltas: con una moneda pendiente esta
// pantalla guarda la ficha en el borrador y devuelve al pedido, así que el
// par de botones se llamaba el uno al otro. El sitemap no dibuja ese pie en
// ninguno de los dos frames del 1/4; ahora tampoco la app.
//
// Three frames behind one route, and which one is drawn depends on two
// things the page resolves here: whether a ficha matched, and whether the
// shopkeeper asked for a separate account (`?nuevo=1`). See
// `OrderClientStep` for what each one is.
export default async function ClienteDelPedidoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string; moneda?: string }>;
}) {
  const { id } = await params;
  const { nuevo, moneda } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", id)
    .eq("owner_id", user!.id)
    .maybeSingle();

  if (error) console.error("[orders] cliente del pedido:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  // La tasa vigente, solo para la hoja de la cuenta del cliente: enseña
  // bolívares bajo cada cifra. `null` en un negocio colombiano.
  const rateContext = await getOwnerRateContext(supabase, user!.id);

  // LAS LÍNEAS, solo para saber qué monedas tiene el pedido. Agrupadas por la
  // moneda sellada, como en el paso 1/4: el servidor no ve el borrador.
  const { data: filas } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", pedido.id);
  const items = (filas ?? []) as CatalogOrderItemRow[];

  // THE HARD STOP, repeated here like on every other step: this URL can be
  // typed or reached with the back button long after the sale was written.
  if (pedido.registered_at != null || pedido.sale_id != null) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const [country, coincidencia] = await Promise.all([
    readOwnerCountry(supabase, user!.id),
    findOrderClient(
      supabase,
      user!.id,
      pedido.customer_document,
      pedido.customer_document_type,
    ),
  ]);

  // `null` FOR BOTH «none» AND «several». With several fichas sharing these
  // digits, nothing in the order tells them apart — see `findOrderClient` —
  // so the honest screen is the one that asks, not one that picks.
  const ficha = coincidencia.kind === "uno" ? coincidencia.cliente : null;

  // SPLIT, NOT PASSED RAW. See `partirDocumento`: this column holds «V-2424…»
  // on some rows and bare digits on others, and the form needs the two halves
  // apart or it warns the shopkeeper about a format they just typed.
  const bloques = bloquesDeMoneda(items, undefined);

  const documento = partirDocumento(
    pedido.customer_document,
    pedido.customer_document_type,
  );

  return (
    <OrderClientStep
      pedidoId={pedido.id}
      // La tasa vigente, para la hoja de la cuenta del cliente.
      ledger={rateContext ? { rate: rateContext.effectiveRate } : null}
      // LAS MONEDAS DEL PEDIDO, en el mismo orden que el paso 1/4 las dibuja.
      // Es lo que deja a esta pantalla contestar el rombo del sitemap --
      // «¿Hay más de una moneda?» -- sin volver a consultar nada.
      monedas={bloques.map((b) => b.moneda)}
      // SI EL `1/4` NO EXISTE EN ESTE FLUJO, este paso es el tercero de tres
      // y no el cuarto de cuatro. Misma función que las otras cuatro
      // pantallas, para que los contadores no se contradigan.
      sinPasoDePedido={unicaMonedaDelPedido(bloques) != null}
      // DE QUÉ MONEDA VIENE, para que la flecha de atrás vuelva a SU pago.
      // `undefined` solo en un enlace viejo que no la llevaba.
      monedaDeOrigen={moneda ?? null}
      ficha={ficha}
      delPedido={{
        name: pedido.customer_name,
        documentId: documento.digits,
        documentType: documento.letter,
        whatsapp: pedido.customer_whatsapp,
        address: pedido.customer_address ?? "",
      }}
      country={country}
      // A SEPARATE ACCOUNT ONLY MEANS ANYTHING WHEN ONE MATCHED. With no
      // ficha the form is already the «new client» form, and honouring
      // `?nuevo=1` there would silently drop the «no encontramos» alert that
      // explains why the shopkeeper is filling it in.
      cuentaSeparada={ficha != null && nuevo === "1"}
    />
  );
}
