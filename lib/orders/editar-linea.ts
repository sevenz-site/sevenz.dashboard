import {
  edicionDeLinea,
  esLineaAgregada,
  fijarLineaAgregada,
  fijarLineaEditada,
  idDeLineaAgregada,
  leerBorrador,
  lineasAgregadasEn,
} from "@/lib/orders/borrador-de-registro";
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
  const borrador = leerBorrador(pedidoId);
  const previas = borrador?.editadas ?? {};
  const vivas = new Set(
    lineasDelPedido.map((l) =>
      l.id === lineaId ? currency : String(previas[l.id]?.currency ?? l.moneda),
    ),
  );
  // ADDED LINES KEEP THEIR CURRENCY ALIVE TOO (2026-11-19). Without them, editing
  // an order line could drop the payment of a block that only an added line
  // still holds.
  for (const [id, a] of Object.entries(borrador?.agregadas ?? {})) {
    vivas.add(id === lineaId ? currency : String(a.currency));
  }

  const escalon = escalonParaCantidad(producto, quantity);
  const bloque = escalon === "wholesale" ? producto.wholesale : producto.retail;
  const unitPrice = escalon ? precioEnMoneda(bloque, currency, rates) : null;

  // AN ADDED LINE IS EDITED THROUGH THE SAME DOOR, so the stepper and the
  // «Cambiar» sheet need no second code path: only where it is stored differs.
  const agregada = esLineaAgregada(lineaId) ? borrador?.agregadas?.[lineaId] : undefined;
  if (agregada) {
    fijarLineaAgregada(
      pedidoId,
      lineaId,
      {
        productId: agregada.productId,
        nombre: agregada.nombre,
        quantity,
        currency,
        ...(unitPrice != null ? { unitPrice } : {}),
      },
      [...vivas],
    );
    return;
  }

  fijarLineaEditada(
    pedidoId,
    lineaId,
    { quantity, currency, ...(unitPrice != null ? { unitPrice } : {}) },
    [...vivas],
  );
}

// ═══════════════════════════════════════════════════════════════════════
// «AGREGAR PRODUCTO» EN EL PASO 1/3 — owner's request of 2026-11-19
//
// What the picker hands over joins the block in the block's currency. Two
// outcomes, both decided by the owner that day:
//
//   · THE PRODUCT IS ALREADY ON A CARD OF THIS BLOCK → it adds to that card
//     («la harina pasa de 4 a 5») and «Cantidad del pedido: 4» stays, so what
//     the customer asked for is still visible. It goes through
//     `aplicarEdicionDeLinea`, so crossing the wholesale minimum re-prices it
//     exactly as the «+» would.
//   · OTHERWISE → a new added line at the end of the list.
//
// "ON A CARD OF THIS BLOCK" MEANS WHAT THE SCREEN SHOWS: an order line of this
// block not moved elsewhere, or an added line now in this currency. A product
// that sits in ANOTHER currency's block becomes a new line here instead of
// growing a card the shopkeeper is not looking at.
// ═══════════════════════════════════════════════════════════════════════
export function agregarAlBloque({
  pedidoId,
  moneda,
  productId,
  nombre,
  quantity,
  producto,
  rates,
  lineasDelBloque,
  lineasDelPedido,
}: {
  pedidoId: string;
  moneda: PriceCurrency;
  productId: string;
  nombre: string;
  quantity: number;
  producto: ProductoPublico;
  rates: BolivarRates | null;
  /** The order lines the server drew in this block, with what they ordered. */
  lineasDelBloque: { id: string; productId: string | null; cantidadPedida: number }[];
  lineasDelPedido: LineaDelPedidoParaEditar[];
}): void {
  const borrador = leerBorrador(pedidoId);

  const delPedido = lineasDelBloque.find((l) => {
    if (l.productId !== productId) return false;
    const e = edicionDeLinea(borrador, l.id);
    return e == null || String(e.currency) === String(moneda);
  });
  if (delPedido) {
    const actual = edicionDeLinea(borrador, delPedido.id)?.quantity ?? delPedido.cantidadPedida;
    aplicarEdicionDeLinea({
      pedidoId,
      lineaId: delPedido.id,
      quantity: actual + quantity,
      currency: moneda,
      producto,
      rates,
      lineasDelPedido,
    });
    return;
  }

  const yaAgregada = lineasAgregadasEn(borrador, moneda).find((a) => a.productId === productId);
  if (yaAgregada) {
    aplicarEdicionDeLinea({
      pedidoId,
      lineaId: yaAgregada.id,
      quantity: yaAgregada.quantity + quantity,
      currency: moneda,
      producto,
      rates,
      lineasDelPedido,
    });
    return;
  }

  const escalon = escalonParaCantidad(producto, quantity);
  const bloque = escalon === "wholesale" ? producto.wholesale : producto.retail;
  const unitPrice = escalon ? precioEnMoneda(bloque, moneda, rates) : null;
  const vivas = new Set<string>([
    ...lineasDelPedido.map((l) => String(borrador?.editadas?.[l.id]?.currency ?? l.moneda)),
    ...Object.values(borrador?.agregadas ?? {}).map((a) => String(a.currency)),
    moneda,
  ]);
  fijarLineaAgregada(
    pedidoId,
    idDeLineaAgregada(),
    { productId, nombre, quantity, currency: moneda, ...(unitPrice != null ? { unitPrice } : {}) },
    [...vivas],
  );
}
