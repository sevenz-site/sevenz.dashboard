"use client";

import { useRouter } from "next/navigation";
import { ProductDetail } from "@/components/public/product-detail";
import { aplicarEdicionDeLinea } from "@/lib/orders/editar-linea";
import { type ProductoPublico } from "@/lib/products/public-pricing";
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
  monedaInicial,
  rates,
  stock,
  monedasDelLibro,
  lineasDelPedido,
  alTerminar,
}: {
  pedidoId: string;
  lineaId: string;
  productId: string;
  producto: ProductoPublico;
  // WHAT THE CUSTOMER ORDERED, or what a previous visit to this screen left.
  // Opening at the catalogue's minimum instead would turn an order of five
  // into an order of one without saying so.
  cantidad: number;
  // LA MONEDA DEL BLOQUE que se está confirmando. Se usa para una sola cosa:
  // saber si al guardar la línea se va a OTRO bloque, y entonces llevar al
  // tendero allí.
  moneda: PriceCurrency;
  // LA QUE SE DIBUJA SELECCIONADA al abrir, que es la del borrador cuando el
  // tendero ya movió esta línea. Sin separarla, reabrir la hoja enseñaba la
  // moneda del bloque viejo y «Agregar» la devolvía ahí sin decir nada.
  monedaInicial?: PriceCurrency;
  rates: BolivarRates | null;
  // TODAS las líneas del pedido con su moneda sellada, para poder decir qué
  // bloques quedan vivos después de esta edición. Ver `alAgregar`.
  lineasDelPedido: { id: string; moneda: string }[];
  // Lo que hay que hacer al guardar, cuando este formulario vive dentro de
  // una hoja. Recibe la moneda NUEVA si la edición movió la línea de bloque,
  // o `null` si se quedó donde estaba.
  alTerminar?: (monedaNueva: string | null) => void;
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
      monedaInicial={monedaInicial ?? moneda}
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
        // UNA SOLA COPIA, en `lib/orders/editar-linea.ts`. Salió de aquí el
        // 2026-10-28, cuando la cantidad pasó a poder cambiarse también con
        // «−» y «+» desde la lista: dos pantallas tocando la misma línea, y
        // esto mueve dinero.
        aplicarEdicionDeLinea({
          pedidoId,
          lineaId,
          quantity,
          currency,
          producto,
          rates,
          lineasDelPedido,
        });

        // ── QUÉ PASA DESPUÉS, Y AQUÍ HUBO UN FALLO REAL ────────────────
        //
        // El dueño el 2026-10-25: *«al seleccionar "Agregar 00" desde el
        // detalle del producto, no está realizando ninguna acción, o por lo
        // menos no de cara al usuario»*. Tenía razón y la causa es sutil:
        // esto hacía `router.push` al paso 2/4 **de la misma moneda**, o sea
        // a la URL en la que ya estábamos. Next no repinta nada, la hoja no
        // se entera, y el tendero ve el botón hundirse y nada más. La
        // cantidad SÍ se guardaba — lo que faltaba era decirlo.
        //
        // TRES SALIDAS, Y SOLO UNA ES UNA NAVEGACIÓN:
        if (alTerminar) {
          // Dentro de la hoja: la cierra y refresca la pantalla de detrás.
          // Si la línea cambió de moneda, el bloque donde estaba ya no la
          // tiene, así que además hay que llevar al nuevo.
          alTerminar(currency !== moneda ? currency : null);
          return;
        }
        // Fuera de la hoja -la ruta vieja, que sigue viva para un enlace
        // antiguo- sí se navega.
        router.push(
          `/productos/ordenes/${pedidoId}/registrar/confirmar?moneda=${currency}`,
        );
      }}
    />
  );
}
