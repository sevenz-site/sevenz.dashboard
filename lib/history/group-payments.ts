// ONE ABONO, ONE ROW: the lines of a split payment, put back together.
//
// Owner's request of 2026-10-30, from a user's comment: an abono of USD 20
// split across four USD 5 fiados showed up in the history as FOUR separate
// transactions, and that read as four payments. The history should show ONE
// abono for the amount paid, and its detail the split.
//
// ===========================================================================
// WHY THE KEY IS THE TRANSACTION CODE AND NOT `payment_group_id`
//
// The owner's screen has `payment_group_id`; the client's does not --
// `get_shared_balance` never sent it -- and both screens must group the same
// way (CLAUDE.md: the decision lives in `lib/` and both faces share it). The
// code does travel to both (migration 148), and migration 147 gives every line
// of a split payment the SAME code by construction: its grouping key is
// `coalesce(sale_id, payment_group_id, id)`. So grouping by code needs no
// migration and cannot disagree between the two screens.
//
// A LINE WITHOUT A CODE STAYS ON ITS OWN. Nothing written since migration 147
// lacks one, and the safe failure of "no code" is the old behaviour -- one row
// per line -- never two different payments merged into one.
//
// ===========================================================================
// ONE ROW PER BOOK, NOT PER PAYMENT
//
// A payment typed in bolivars can be split across the dollar AND the euro book
// (`registrarAbonoRepartido`). A row shows one amount with one flag and a «Por
// cobrar» of one book, so those become two rows, one per currency -- the same
// rule a mixed sale already follows (`/transacciones/venta/<sale>/<currency>`,
// owner's decision of 2026-10-20: «una venta mixta son dos filas
// independientes»).
//
// ===========================================================================
// WHICH LINE SPEAKS FOR THE GROUP
//
// The LAST one in the order the ledger is chained -- `created_at, id`
// ascending, which is what `recalc_client_running_balance` walks. Its
// `running_balance` is what the book owed after the WHOLE payment, so the
// row's «Por cobrar» matches the balance card exactly as a single abono's did.
// Lowercase hex uuids sort the same as Postgres compares them, so a string
// comparison of `id` is the same tie-break the database uses.

export type GroupableMovement = {
  id: string;
  type: "charge" | "payment";
  currency: string | null;
  amount: number | string;
  created_at: string;
  transaction_code?: string | null;
  running_balance?: number | string | null;
  entry_currency?: string | null;
  entry_amount?: number | string | null;
};

export type PaymentGroup<T> = {
  // The row to draw: the last line, carrying the group's total.
  row: T;
  // Every line, in ledger order. One element for anything not split.
  lines: T[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const ledgerOrder = (a: GroupableMovement, b: GroupableMovement) =>
  a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at);

/** The key that decides which payment lines are one abono. */
export function paymentGroupKey(m: GroupableMovement): string {
  if (m.type !== "payment" || !m.transaction_code) return `id:${m.id}`;
  return `code:${m.transaction_code}|${m.currency ?? "COP"}`;
}

export function groupPayments<T extends GroupableMovement>(movements: T[]): PaymentGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const m of movements) {
    const key = paymentGroupKey(m);
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }

  const groups: PaymentGroup<T>[] = [];
  for (const lines of byKey.values()) {
    if (lines.length === 1) {
      groups.push({ row: lines[0], lines });
      continue;
    }
    const ordered = [...lines].sort(ledgerOrder);
    const last = ordered[ordered.length - 1];

    // THE TYPED BOLIVARS SURVIVE ONLY IF EVERY LINE HAS THEM. Their sum is then
    // exactly what the shopkeeper typed for this book: `registrarAbonoRepartido`
    // refuses a split whose parts do not add up to the bill (CLAUDE.md, «SIEMPRE
    // MANDA EL MONTO QUE TECLEÓ EL TENDERO»). With one line typed in dollars no
    // typed figure describes the sum, and none is invented.
    const allTypedInBolivars = ordered.every(
      (l) => l.entry_currency === "VES" && l.entry_amount != null,
    );

    groups.push({
      row: {
        ...last,
        amount: round2(ordered.reduce((sum, l) => sum + Number(l.amount), 0)),
        entry_currency: allTypedInBolivars ? "VES" : null,
        entry_amount: allTypedInBolivars
          ? round2(ordered.reduce((sum, l) => sum + Number(l.entry_amount), 0))
          : null,
      },
      lines: ordered,
    });
  }
  return groups;
}
