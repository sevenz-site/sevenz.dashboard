import { notFound, redirect } from "next/navigation";
import { OrderClientStep } from "@/components/dashboard/order-client-step";
import { createClient } from "@/lib/supabase/server";
import { readOwnerCountry } from "@/lib/owner-country";
import {
  findOrderClient,
  partirDocumento,
} from "@/lib/orders/order-client-match";
import {
  ORDER_COLUMNS,
  type CatalogOrderRow,
} from "@/lib/orders/catalog-orders";

// WHO THE SALE GOES TO — the step the order's «Continuar» leads to.
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
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { id } = await params;
  const { nuevo } = await searchParams;
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
  const documento = partirDocumento(
    pedido.customer_document,
    pedido.customer_document_type,
  );

  return (
    <OrderClientStep
      pedidoId={pedido.id}
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
