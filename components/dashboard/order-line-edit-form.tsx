"use client";

import { useRouter } from "next/navigation";
import { ProductDetail } from "@/components/public/product-detail";
import { fijarLineaEditada, leerBorrador } from "@/lib/orders/borrador-de-registro";
import type { ProductoPublico } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// STEP 1/2 «EDITA PRODUCTO» — frame `1566:13300`, reached from «Editar» on an
// order line. The sitemap's arrow says so, labelled «Selecicona "Editar"».
//
// ===========================================================================
// IT IS THE CATALOGUE'S OWN PRODUCT DETAIL, NOT A SCREEN THAT LOOKS LIKE IT
//
// `ProductDetail` is what the customer saw when they ordered and what the
// sale wizard already mounts. Writing a third version of the tiers, the
// wholesale minimum, the currencies and their bolívar equivalences would mean
// three copies of the pricing rules — and the day one changes, the shopkeeper
// charges one figure while his customer's screen shows another.
//
// ===========================================================================
// WHAT «EDITAR» ACTUALLY CHANGES, AND WHAT IT CANNOT
//
// Quantity and currency. The product's own catalogue data — name, price,
// description — is NOT edited here despite the frame's title: this screen
// prices the LINE, and changing the catalogue from inside a sale would
// silently reprice every other order waiting to be registered.
//
// The edit is kept in the same draft as the payments and NOT written to
// `catalog_order_items`: that row is what the customer agreed to, and it
// stays sealed until the sale is written.
export function OrderLineEditForm({
  pedidoId,
  lineaId,
  productId,
  producto,
  cantidad,
  moneda,
  rates,
  stock,
  monedasDelLibro,
  lineasDelPedido,
}: {
  pedidoId: string;
  lineaId: string;
  productId: string;
  producto: ProductoPublico;
  // WHAT THE CUSTOMER ORDERED, or what a previous visit to this screen left.
  // Opening at the catalogue's minimum instead would turn an order of five
  // into an order of one without saying so.
  cantidad: number;
  moneda: PriceCurrency;
  rates: BolivarRates | null;
  // TODAS las líneas del pedido con su moneda sellada, para poder decir qué
  // bloques quedan vivos después de esta edición. Ver `alAgregar`.
  lineasDelPedido: { id: string; moneda: string }[];
  stock: number | null;
  monedasDelLibro: PriceCurrency[];
}) {
  const router = useRouter();

  return (
    <ProductDetail
      // TOKEN VACÍO A PROPÓSITO, the same reason `ProductSheet` passes one:
      // with `alAgregar` set, neither the customer's cart nor the link back to
      // the public catalogue is reached, and passing the business's real token
      // would force creating its catalogue link just to open this screen.
      token=""
      productId={productId}
      producto={producto}
      cantidadInicial={cantidad}
      monedaInicial={moneda}
      rates={rates}
      stock={stock}
      // THE LEDGER'S CURRENCIES, never bolívares or USDT: `movements.currency`
      // does not take them. Without this the screen would offer a currency the
      // sale refuses at save time.
      monedasPermitidas={monedasDelLibro}
      alAgregar={({ quantity, currency }) => {
        // ── `monedasVivas` NO ES OPCIONAL, Y ES EL ARREGLO DE UN BORDE ───
        //
        // Mover esta línea a otra moneda puede dejar un bloque VACÍO, y con
        // él un abono ya tecleado apuntando a una moneda que ya no tiene
        // nada que cobrar. No falla, no avisa, y el dinero queda abonado
        // donde no se debía. `fijarLineaEditada` lo limpia -- pero solo
        // puede si le dicen qué monedas quedan, así que lo exige.
        //
        // SE CALCULA AQUÍ Y NO DENTRO porque el borrador no conoce las
        // líneas del pedido: solo esta pantalla, que las recibió del
        // servidor, sabe cuáles son.
        const previas = leerBorrador(pedidoId)?.editadas ?? {};
        const vivas = new Set(
          lineasDelPedido.map((l) =>
            l.id === lineaId ? currency : String(previas[l.id]?.currency ?? l.moneda),
          ),
        );
        fijarLineaEditada(pedidoId, lineaId, { quantity, currency }, [...vivas]);
        // DE VUELTA AL PASO 2/4 DE ESA MONEDA, que es donde el tendero
        // estaba. Si la línea se movió, va al bloque NUEVO: seguir en el
        // viejo enseñaría una pantalla sin la línea que se acaba de tocar.
        router.push(
          `/productos/ordenes/${pedidoId}/registrar/confirmar?moneda=${currency}`,
        );
      }}
    />
  );
}
