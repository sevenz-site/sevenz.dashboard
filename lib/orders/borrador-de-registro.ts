// THE ORDER BEING TURNED INTO A SALE, LINE BY LINE, WHILE THE SHOPKEEPER
// WALKS THE FLOW.
//
// ===========================================================================
// NOTHING IS WRITTEN TO THE DATABASE UNTIL THE VERY END
//
// The sitemap's own arrows say so: «Registrar» on a line opens 1/2, 1/2 goes
// to 2/2, and 2/2 comes BACK to the order (`1564:11979`), which then goes to
// the client's details and only there to «Registrar y finalizar». Four
// screens, three navigations, and the sale is written once at the end.
//
// So each line's payment has to survive the walk, and it is `sessionStorage`
// that carries it — the same decision, for the same reason, as
// `lib/abonos/borrador.ts`: what lives here is a draft IN FLIGHT, not a
// record.
//
// ===========================================================================
// IF IT IS LOST, NOTHING IS LOST
//
// `CLAUDE.md` is explicit that iOS wipes browser storage without asking, and
// that nothing which matters may depend on the browser cooperating. This
// obeys that rule by WHAT it holds, not by where: lose it and the shopkeeper
// types the amount again. No money is misfiled, no movement is half-written,
// because while this is alive the database holds nothing at all.
//
// What must NOT happen is that it comes back from the dead: yesterday's
// draft, over an order whose prices have since changed, would draw a sale
// nobody agreed to and say nothing about it. Hence the expiry.

const CLAVE = "sevenz:pedido-registro";

// Two hours, the same as the payment split's. Registering an order is a
// counter-top conversation: it starts and ends with the customer in front of
// you. Past that, whatever is stored is far likelier to be an abandoned
// session than something anybody wants back.
const CADUCIDAD_MS = 2 * 60 * 60 * 1000;

// ONE LINE'S PAYMENT, exactly as `PagoCampos` hands it over. The field names
// are that component's `Registro` and not a translation of it: renaming them
// here would mean a mapping in both directions, and a mapping is where a
// currency quietly swaps places with an amount.
export type PagoDeLinea = {
  // What goes into the ledger of this line's currency TODAY.
  amount: number;
  // What was actually handed over, and in what. `null` = the ledger's own
  // currency. This is the pair `CLAUDE.md` calls «el monto que tecleó el
  // tendero»: it is kept verbatim and never recomputed from `amount`.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  plazo: string;
  cuotas: string;
  usarPrevista: boolean;
  photoPath: string | null;
  description: string;
};

// WHAT «EDITAR» CHANGED ON A LINE, which is quantity and currency and
// nothing else. The product's catalogue data is not touched from inside a
// sale -- see `order-line-edit-form.tsx`.
//
// IT IS SEPARATE FROM THE PAYMENT because the two screens write it at
// different moments and either can happen without the other: «Registrar»
// goes straight to the payment and never edits, «Editar» edits and then goes
// to the payment. One object with both would make each screen responsible for
// carrying the other's half -- which is exactly how the payment split lost
// its `aManoBs` on 2026-10-23.
// ===========================================================================
// AND THE FINAL SUMMARY HAS TO SAY SO WHEN IT DIFFERS
//
// The owner's decision of 2026-10-24, answering the question this very edit
// raises: *«el resumen final debe decir "el cliente pidió 5" y lo que se está
// registrando cuando difiera»*.
//
// So «Resumen V2» (frame `1519:11271`) reads BOTH numbers and shows the pair
// only where they disagree -- what the customer asked for and what is being
// registered. That is why this type exists apart from the sealed line instead
// of overwriting it: the moment the edit replaced `catalog_order_items`, the
// original quantity would be gone and the summary would have nothing to
// compare against.
//
// IT IS NOT BUILT YET -- the summary screen does not exist. This note is here
// and not only in a commit message because whoever builds it will be reading
// this file to find the edit, not searching the history for a decision they
// do not know was taken.
export type LineaEditada = {
  quantity: number;
  currency: string;
};

export type BorradorDeRegistro = {
  pedidoId: string;
  // Keyed by `catalog_order_items.id`. A line the shopkeeper has not resolved
  // yet is simply absent, which is what the order screen reads to know which
  // ones still show «Registrar».
  lineas: Record<string, PagoDeLinea>;
  // Keyed by `catalog_order_items.id` as well. Absent = the shopkeeper did not
  // edit that line, so what the customer ordered stands.
  editadas?: Record<string, LineaEditada>;
  guardadoEn: number;
};

function leerTodo(): BorradorDeRegistro | null {
  // EVERY READ IS WRAPPED. In a private window, or with site data blocked,
  // the accessor itself throws — it does not return empty. A screen that
  // crashed on that would be unusable for exactly the owners whose phones are
  // strictest, which in this product is most of them.
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as BorradorDeRegistro;
    if (!b || typeof b.pedidoId !== "string" || typeof b.guardadoEn !== "number") return null;
    if (Date.now() - b.guardadoEn > CADUCIDAD_MS) {
      borrarBorrador();
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

// WHAT THIS ORDER HAS RESOLVED SO FAR. It takes the order's id and returns
// nothing for any other, which is the whole guard: a draft belongs to ONE
// order, and opening a second one must not inherit the first one's payments.
export function leerBorrador(pedidoId: string): BorradorDeRegistro | null {
  const b = leerTodo();
  if (!b || b.pedidoId !== pedidoId) return null;
  return b;
}

export function leerPagoDeLinea(pedidoId: string, lineaId: string): PagoDeLinea | null {
  return leerBorrador(pedidoId)?.lineas[lineaId] ?? null;
}

// ONE LINE'S PAYMENT, MERGED INTO WHATEVER IS ALREADY THERE.
//
// IT READS BEFORE IT WRITES, and that is not ceremony. `CLAUDE.md` has the
// scar: on 2026-10-23 the payment-split screen wrote the whole draft on every
// render and erased the `aManoBs` the amount screen had just put there — the
// figure was stored correctly and lost an instant later. Writing one key at a
// time, from the current value, is what stops the same shape of bug here,
// where each line is written by its own screen.
export function fijarPagoDeLinea(pedidoId: string, lineaId: string, pago: PagoDeLinea): void {
  try {
    const actual = leerBorrador(pedidoId);
    const siguiente: BorradorDeRegistro = {
      pedidoId,
      lineas: { ...(actual?.lineas ?? {}), [lineaId]: pago },
      guardadoEn: Date.now(),
    };
    sessionStorage.setItem(CLAVE, JSON.stringify(siguiente));
  } catch {
    // Storage refused. The shopkeeper will be asked for the amount again,
    // which is the designed failure of this whole file.
  }
}

// THE SAME READ-THEN-WRITE as `fijarPagoDeLinea`, and for the same scar: a
// screen that writes the whole draft erases what the other one just put in.
export function fijarLineaEditada(
  pedidoId: string,
  lineaId: string,
  edicion: LineaEditada,
): void {
  try {
    const actual = leerBorrador(pedidoId);
    const siguiente: BorradorDeRegistro = {
      pedidoId,
      lineas: actual?.lineas ?? {},
      editadas: { ...(actual?.editadas ?? {}), [lineaId]: edicion },
      guardadoEn: Date.now(),
    };
    sessionStorage.setItem(CLAVE, JSON.stringify(siguiente));
  } catch {
    // Storage refused; the edit is simply not remembered.
  }
}

export function leerLineaEditada(pedidoId: string, lineaId: string): LineaEditada | null {
  return leerBorrador(pedidoId)?.editadas?.[lineaId] ?? null;
}

export function quitarPagoDeLinea(pedidoId: string, lineaId: string): void {
  try {
    const actual = leerBorrador(pedidoId);
    if (!actual) return;
    const lineas = { ...actual.lineas };
    delete lineas[lineaId];
    sessionStorage.setItem(
      CLAVE,
      JSON.stringify({ ...actual, lineas, guardadoEn: Date.now() }),
    );
  } catch {
    // Same as above.
  }
}

export function borrarBorrador(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Same as above.
  }
}
