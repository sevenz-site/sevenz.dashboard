// WHAT THE CLIENT TOOK IN A MOVEMENT — the shape, and the one sum.
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
// Migration `122` is the other half. Its comments carry the owner's three
// decisions of 2026-10-17 that shaped all of this.

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
export type MovementProductRow = {
  name: string;
  quantity: number;
  unitPrice: number;
};
