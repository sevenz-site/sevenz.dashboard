import { fijarLineaEditada, leerBorrador } from "@/lib/orders/borrador-de-registro";
import {
  escalonParaCantidad,
  precioEnMoneda,
  type ProductoPublico,
} from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// CAMBIAR UNA LÍNEA DE UN PEDIDO: UN SOLO SITIO
//
// Esto vivía DENTRO de `order-line-edit-form.tsx`, que era su único llamador.
// Salió aquí el 2026-10-28, cuando el dueño pidió que la cantidad se pudiera
// cambiar con «−» y «+» desde la propia lista (frame `1389:8388`) en vez de
// entrando a una hoja: a partir de ahí son DOS pantallas las que tocan la
// misma línea.
//
// Y ESTO MUEVE DINERO, así que dos copias no es una opción. Lo dice el propio
// comentario que venía con el código: *«es la única forma de que la cifra que
// el tendero ve aquí y la que se escribe en la venta no puedan separarse. Si
// un día cambia la regla de escalones, cambia para las dos a la vez»*.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ CAMBIAR LA CANTIDAD RE-CALCULA EL PRECIO, Y NO ES UN DESCUIDO
//
// Un pedido llega con su precio SELLADO -- el que el cliente vio en el
// catálogo-- y `CLAUDE.md` exige que se cobre ese y no el de hoy. Eso vale
// para las líneas que el tendero NO toca.
//
// En cuanto toca la cantidad, la cosa cambia: subir de 5 a 6 unidades puede
// cruzar el mínimo del mayoreo y bajar el precio unitario. Dejar el sellado
// ahí cobraría precio de detal por una cantidad de mayoreo. Por eso se usan
// `escalonParaCantidad` y `precioEnMoneda`, que son LAS MISMAS que usa
// `registrarVenta`.
//
// ───────────────────────────────────────────────────────────────────────
// SIN TASA NO SE INVENTA UN PRECIO
//
// `precioEnMoneda` devuelve `null` en un negocio sin tasa del BCV ahora
// mismo. Entonces NO se guarda precio: la pantalla sigue dibujando el
// sellado, y la venta fallará con su propio mensaje, que es más claro que una
// cifra inventada aquí.
// ═══════════════════════════════════════════════════════════════════════

// `moneda` COMO TEXTO Y NO COMO `PriceCurrency`: lo que llega del servidor es
// `sale_lines.currency`/`catalog_order_items.currency`, una columna de texto.
// Estrecharlo aquí obligaría a castear en cada llamador, que es como se cuela
// un libro equivocado.
export type LineaDelPedidoParaEditar = {
  id: string;
  moneda: string;
};

export function aplicarEdicionDeLinea({
  pedidoId,
  lineaId,
  quantity,
  currency,
  producto,
  rates,
  lineasDelPedido,
}: {
  pedidoId: string;
  lineaId: string;
  quantity: number;
  currency: PriceCurrency;
  producto: ProductoPublico;
  rates: BolivarRates | null;
  /** Todas las del pedido: hacen falta para saber qué monedas quedan vivas. */
  lineasDelPedido: LineaDelPedidoParaEditar[];
}): void {
  // LAS MONEDAS QUE QUEDAN VIVAS se calculan aquí y no dentro del borrador:
  // el borrador no conoce las líneas del pedido, solo la pantalla que las
  // recibió del servidor.
  const previas = leerBorrador(pedidoId)?.editadas ?? {};
  const vivas = new Set(
    lineasDelPedido.map((l) =>
      l.id === lineaId ? currency : String(previas[l.id]?.currency ?? l.moneda),
    ),
  );

  const escalon = escalonParaCantidad(producto, quantity);
  const bloque = escalon === "wholesale" ? producto.wholesale : producto.retail;
  const unitPrice = escalon ? precioEnMoneda(bloque, currency, rates) : null;

  fijarLineaEditada(
    pedidoId,
    lineaId,
    { quantity, currency, ...(unitPrice != null ? { unitPrice } : {}) },
    [...vivas],
  );
}
