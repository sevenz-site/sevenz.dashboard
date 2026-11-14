// WHAT THE CLIENT TOOK — the shape, and the one sum.
//
// IT LIVES IN `lib/` AND NOT IN THE FIELD COMPONENT because three sides need
// it and only one of them is a screen: the picker builds these lines, the
// server action validates and stores them, and the movement's card adds them
// up to show the difference against the amount. A type exported from a
// `"use client"` file and imported by a server action works -- types are
// erased -- but it points the dependency the wrong way, and the next person
// importing something that is NOT a type from there gets a client module
// pulled into a server bundle.
//
// ===========================================================================
// ESTE ARCHIVO SE LLAMABA `movement-products.ts` HASTA EL 2026-10-17
//
// Las líneas colgaban del MOVIMIENTO (`movement_products`, migración `122`).
// Dejaron de hacerlo al llegar la venta: una venta pagada al contado **no
// escribe nada en `movements`** —el recálculo del saldo no tiene fila neutra,
// ver la migración `124`— así que sus productos no tenían movimiento del que
// colgar.
//
// Ahora cuelgan de la VENTA, y un fiado manual es «una venta sin pago». Una
// sola tabla contesta «qué se llevó el cliente», que era la alternativa a
// tener dos y que cada pantalla mirara en una o se quedara a medias.
//
// Se renombró el archivo y no solo su contenido a propósito: el nombre
// anterior nombraba una tabla que ya no existe, y un módulo que miente sobre
// dónde vive el dato es la clase de pista falsa que cuesta una tarde.

export type LineaDeProducto = {
  // null = a product the shopkeeper typed on the spot and that does not exist
  // yet. The server creates it when the movement is saved.
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
};

// THE SUM LIVES ONCE. The form needs it to fill in the amount, and the card
// needs it to show the difference when the shopkeeper overrode that amount --
// two copies would eventually disagree by a rounding step, and the screen
// would be arguing with itself about money.
//
// Two decimals, ordinary rounding: the same `redondear` the rest of the
// pricing code uses.
//
// IT TAKES THE MINIMUM IT NEEDS -- quantity and price -- rather than a named
// type, so the same function serves the line being typed into the form and the
// line already stored. Two functions adding up the same thing is exactly the
// duplication this one exists to prevent.
export function totalDeLineas(lineas: { quantity: number; unitPrice: number }[]): number {
  const total = lineas.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  return Math.round(total * 100) / 100;
}

// UNA LÍNEA YA GUARDADA, tal como la pinta la ficha del movimiento. Es la
// misma forma que `LineaDeProducto` sin `productId`: la ficha enseña qué se
// llevó, no a qué producto del inventario apunta -- y el día que ese producto
// se borre, la línea tiene que seguir leyéndose igual.
export type SaleLineRow = {
  name: string;
  quantity: number;
  unitPrice: number;
  // Migration 185. `id` only where a return can be registered: the owner's
  // detail of a fiado. `devuelto` is how many units came back, on both faces.
  // `stockCounted` says whether the shelf moves, so the modal can tell.
  id?: string;
  devuelto?: number;
  // What those units were worth. The next return is worked out from it.
  devueltoValor?: number;
  stockCounted?: boolean;
};

// WHICH LINES OF A SALE BELONG TO ONE BOOK. A sale can be paid in two currencies: the
// dollar lines cash, the euro lines on credit. A fiado is one book of that sale, so it is
// named after ITS lines only. Found in production on 2026-11-13 during the money-path
// checklist: a mixed sale (Malta $0,80 cash, Camiseta €17,61 on credit) showed the euro
// fiado as «Fiado • Malta • Camiseta» in the shopkeeper's history -- the malta listed as
// owed when it had been paid. The amount was right; the label said something false.
//
// The client's view already filtered this way since migration 139 (`get_shared_balance`)
// and so did the transaction detail (`lineasDe`); three owner screens did not, so the two
// faces of the same fiado disagreed. This is the one rule, for every screen.
//
// NORMALISED: `sale_lines` spells the Colombian book 'COP' and `movements` spells it
// NULL. Comparing the raw columns matches no Colombian line at all.
export function libroDeLinea(currency: string | null | undefined): string {
  return !currency || currency === "COP" ? "COP" : currency;
}

export function lineaDelLibro(
  lineCurrency: string | null | undefined,
  movementCurrency: string | null | undefined,
): boolean {
  return libroDeLinea(lineCurrency) === libroDeLinea(movementCurrency);
}

// The key of «this sale, this book», for maps of product names built once per page.
export function claveDeLibro(saleId: string, currency: string | null | undefined): string {
  return `${saleId}|${libroDeLinea(currency)}`;
}
