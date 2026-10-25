"use client";

import { useRouter } from "next/navigation";
import { ProductDetail } from "@/components/public/product-detail";
import { fijarLineaEditada } from "@/lib/orders/borrador-de-registro";
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
        fijarLineaEditada(pedidoId, lineaId, { quantity, currency });
        // STRAIGHT ON TO 2/2, which is where the sitemap's «Agregar $00.00»
        // arrow points — `1566:13374` to `1564:11106`.
        router.push(`/productos/ordenes/${pedidoId}/registrar/${lineaId}/abono`);
      }}
    />
  );
}
