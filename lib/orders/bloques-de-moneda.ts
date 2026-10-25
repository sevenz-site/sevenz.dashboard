import type { CatalogOrderItemRow } from "@/lib/orders/catalog-orders";
import type { LineaEditada } from "@/lib/orders/borrador-de-registro";
import type { PriceCurrency } from "@/lib/products/price";

// THE ORDER, GROUPED THE WAY IT IS NOW REGISTERED: BY CURRENCY.
//
// ===========================================================================
// WHY THIS IS A MODULE AND NOT A `reduce` INSIDE THE SCREEN
//
// `CT-147` turned the currency into the unit of work, so FOUR different places
// need the same answer to «what currencies does this order have, and what is
// in each»: the `1/4 Pedido` screen that draws one card per block, the
// `2/4 Confirmar` screen that lists one block's lines, the edit form that has
// to say which blocks survive its change, and the commit that calls the
// server once per block.
//
// Four copies of this grouping is four chances for them to disagree, and the
// way they would disagree is the worst one available: a currency the screen
// does not draw is a currency nobody registers, so the shopkeeper finishes
// the flow believing the order is done with part of it never written down.
//
// ===========================================================================
// «EDITAR» DECIDES WHICH BLOCK A LINE IS IN, NOT THE CATALOGUE
//
// A line is grouped by the currency the shopkeeper CHOSE, falling back to the
// one the customer ordered in. Grouping by the sealed currency would put a
// line in a block whose sale will never contain it — the card would promise a
// total the sale does not write.
//
// A LINE WHOSE PRODUCT IS GONE STILL COUNTS HERE, and it is deliberate: the
// `2/4` screen has to show it so the shopkeeper learns why it is being left
// out. What must not count it is anything deciding whether a block is
// REGISTRABLE, which is why `tieneAlgoQueCobrar` is separate.

export type LineaDelBloque = {
  id: string;
  productId: string | null;
  nombre: string;
  // What the customer agreed to, and what is being registered. They differ
  // only when «Editar» changed the quantity, and the screens show the pair
  // only then — the owner's decision of 2026-10-24: *«el resumen final debe
  // decir "el cliente pidió 5" y lo que se está registrando cuando difiera»*.
  cantidadPedida: number;
  cantidad: number;
  precioUnitario: number;
  // The currency the customer ordered in, kept so a moved line can say so.
  monedaSellada: string;
};

export type BloqueDeMoneda = {
  moneda: PriceCurrency;
  lineas: LineaDelBloque[];
  // Only the lines that can actually become a sale. A block whose products
  // all left the catalogue totals zero and cannot be registered.
  total: number;
};

export function bloquesDeMoneda(
  lineas: readonly CatalogOrderItemRow[],
  editadas: Record<string, LineaEditada> | undefined,
): BloqueDeMoneda[] {
  const porMoneda = new Map<string, LineaDelBloque[]>();
  for (const l of lineas) {
    const edicion = editadas?.[l.id];
    const moneda = String(edicion?.currency ?? l.currency ?? "");
    if (moneda === "") continue;
    const lista = porMoneda.get(moneda) ?? [];
    lista.push({
      id: l.id,
      productId: l.product_id,
      nombre: l.product_name,
      cantidadPedida: Number(l.quantity),
      cantidad: Number(edicion?.quantity ?? l.quantity),
      precioUnitario: Number(l.unit_price),
      monedaSellada: String(l.currency ?? ""),
    });
    porMoneda.set(moneda, lista);
  }

  // ORDERED, AND NOT BY `Map` INSERTION. The screen draws these as a list the
  // shopkeeper works through top to bottom, and a list that reshuffles because
  // a line moved is one where the block you were about to tap is somewhere
  // else. Dollars first because it is the ledger most of these shops quote in.
  const orden = ["USD", "EUR", "COP"];
  return [...porMoneda.entries()]
    .map(([moneda, lineasDelBloque]) => ({
      moneda: moneda as PriceCurrency,
      lineas: lineasDelBloque,
      total: lineasDelBloque.reduce(
        (suma, l) => suma + (l.productId ? l.precioUnitario * l.cantidad : 0),
        0,
      ),
    }))
    .sort((a, b) => {
      const ia = orden.indexOf(a.moneda);
      const ib = orden.indexOf(b.moneda);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

// A BLOCK WITH NOTHING LEFT TO SELL. Every one of its products has gone from
// the catalogue, so `registrarPedidoComoVenta` would refuse it — and the
// screen must not offer «Registrar» on something that cannot be registered.
export function tieneAlgoQueCobrar(bloque: BloqueDeMoneda): boolean {
  return bloque.lineas.some((l) => l.productId != null);
}

// THE CURRENCIES THIS ORDER STILL HAS, which is what `fijarLineaEditada`
// demands before it will store an edit. Computed from the blocks so it cannot
// drift from what the screen drew.
export function monedasVivas(bloques: readonly BloqueDeMoneda[]): string[] {
  return bloques.map((b) => b.moneda);
}
