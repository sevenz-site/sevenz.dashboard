// WHAT A RETURN DOES WITH THE MONEY, for the screen. Owner's decisions of
// 2026-11-03; `registrar_devolucion` (migration 185) enforces the same rules
// and is the one that decides. This file exists so the modal can say the
// consequences BEFORE the shopkeeper presses anything.
//
// ===========================================================================
// THE VALUE PAYS WHAT IS OWED FIRST, AND ONLY THE REST IS ASKED ABOUT
//
// Owner's decision of 2026-11-04, on seeing «sobran €40,57» for a client who
// owed €24,50: *«debe ser el cálculo del monto "Por cobrar" menos el monto a
// devolver ejemplo por cobrar 10 devolución 15, sobran 5»*. Everything below is
// read per currency: a client's balance is one number per book.
//
// The value of a return lowers its own fiado, then the other fiados of that
// currency, oldest first. What is still left is money nobody owes.
//
//   Situation, in that currency             | Left over | What is offered
//   ----------------------------------------|-----------|----------------------
//   The debt is at least the value          | Nothing   | No question, one popup
//   The value passes the debt, or no debt   | Yes       | Saldo a favor, or cash
//   CASH SALE, the value passes a debt      | Yes       | The two above, or the
//                                           |           | whole value in cash
//   A sale with no client (Mostrador)       | All of it | Cash, one popup
//
// Worked example, always the same client: fiado A owes $5, fiado B owes $20, a
// product of $10 is returned from A. A is settled, B falls to $15, «Por cobrar»
// goes from $25 to $15, and nothing is asked.
//
//   B owes only $3   → A and B settled, $2 left over: a favor or cash.
//   Nothing else owed → A settled, $5 left over: a favor (book at -$5) or cash.
//   Fully paid, nothing owed, returns $10: all $10 are left over.
//   A cash sale of €40,57, the client owes €24,50: €16,07 left over.
//
// THE THIRD CHOICE OF THAT ROW, owner's request of 2026-11-04, reported by a
// shopkeeper the same day: *«el dueño es quien decide en acuerdo con el cliente
// si los 10 se le devuelven completos en efectivo o devuelve solo 5 y los otros
// 5 se abonan a lo que debe»*. The client owes $5 and returns $10 paid in cash:
//
//   Abonar $5 y devolver $5    → book at $0, $5 leave the till.
//   Abonar $5 y dejar $5 a favor → book at -$5.
//   Devolver los $10           → book stays at $5, $10 leave the till.
//
// Only on a cash sale: that money really was paid, so it can be handed back
// whole. A fiado's own debt goes first by construction, the function writes it.
//
// HE ALSO LISTED, for that same client: take another product of the same value,
// use the $10 towards a dearer one, or keep $5 in favour. The three are the
// second choice, because a book is one number and cannot hold a debt and a saldo
// at once. With a new product of $10: the $5 of saldo pay half, and the other $5
// go on a fiado or are paid. He ends owing $5 with the product in hand, the same
// as if the $10 had paid for it and the old debt had stayed.
//
// DISPLACED ON 2026-11-04, and both decisions stay written. Until then only the
// return's own fiado was paid automatically: with other fiados owing, the second
// popup offered «Abonar a otros fiados» or cash, a list asked which fiado, and
// cash could go to a client who still owed. The owner chose this knowing all
// three go. The reason for the old way was that «Devolver dinero» should always
// be there; it still is, for whatever is left over.
//
// `registrar_devolucion` and its cash twin ACCEPT cash from a client who owes:
// this order lives in the screen, and migrations 185 and 186 describe the old
// one. Nothing is lost by that: the money is the shop's own to hand out.
//
// WHY EACH ROW IS THE WAY IT IS
//
//   · NOTHING LEFT OVER, NO QUESTION. Offering «Entregar en efectivo» with
//     nothing over would hand out money the shop never received.
//   · SALDO A FAVOR ONLY WITH NO DEBT IN THAT CURRENCY. Owing $20 with $5 in
//     favour can only print «Por cobrar $15». Paying the debts first means that
//     by the time it is offered there is none.
//   · ONLY FIADOS OF THE SAME CURRENCY. A dollar left-over does not pay a euro
//     fiado: owner's ruling of 2026-10-22, «a rate nobody agreed on». A debt in
//     the OTHER currency changes nothing in this table. The exception of
//     2026-10-23 was for bolivares handed over, not for this.
//   · A COLOMBIAN BUSINESS HAS ONE BOOK (currency null), so the table is the
//     same with one column less to think about. Compare with `===` on the
//     ledger's own spelling, never against 'COP'.

// A SALE PAID IN FULL IS THE SAME TABLE (migration 186, owner's request of
// 2026-11-04): a fiado that owes nothing, so all of its value is left over and
// the second popup always comes. Its worked example is at the top of that file.
// One row more: a sale with no client (Mostrador) has nobody to hold a saldo a
// favor, so the money goes back and there is nothing to ask.

// HOW IT REACHES THE SCREEN (sitemap `1976:16103`): with nothing left over, one
// popup. With something left over, a second popup offers «Registrar como saldo a
// favor» or «Devolver dinero». See `components/dashboard/registrar-devolucion-dialog.tsx`.

export type OtherFiado = {
  id: string;
  pending: number;
  // Oldest first is the order the split follows.
  chargeAt: string;
  title: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Half a cent, the tolerance the abonos use.
export const TOLERANCE = 0.005;

// Exact on halves, unlike `round2`: 3 x 3,335 is 10,004999… as a float and has to
// land where Postgres puts it, or the screen and the ledger part by a cent.
const roundHalfUp = (n: number) => Number(`${Math.round(Number(`${n.toFixed(6)}e2`))}e-2`);

/**
 * WHAT THE UNITS BEING RETURNED ARE WORTH (migration 188). The same arithmetic as
 * both `registrar_devolucion` functions, which are the ones that decide: the
 * line's running total less what already came back, never above what is left of
 * the sale. So the last of 3 at $4,50 charged at $13 is worth $4,00.
 */
export function returnValue(
  quantity: number,
  unitPrice: number,
  returnedQuantity: number,
  returnedValue: number,
  ceiling: number,
) {
  const value = round2(roundHalfUp((returnedQuantity + quantity) * unitPrice) - returnedValue);
  return Math.max(0, Math.min(value, round2(ceiling)));
}

export function splitOfReturn(value: number, pendingOfFiado: number) {
  const own = round2(Math.min(value, pendingOfFiado));
  const leftOver = round2(value - own);
  return leftOver < TOLERANCE ? { own: round2(value), leftOver: 0 } : { own, leftOver };
}

/** What is left after the fiados, oldest first, take what they can. */
export function spreadOverFiados(
  leftOver: number,
  fiados: OtherFiado[],
): { lines: { fiado_id: string; amount: number }[]; rest: number } {
  const lines: { fiado_id: string; amount: number }[] = [];
  let rest = round2(leftOver);
  for (const f of [...fiados].sort((a, b) => a.chargeAt.localeCompare(b.chargeAt))) {
    if (rest < TOLERANCE) break;
    const amount = round2(Math.min(f.pending, rest));
    if (amount <= 0) continue;
    lines.push({ fiado_id: f.id, amount });
    rest = round2(rest - amount);
  }
  return { lines, rest: rest < TOLERANCE ? 0 : rest };
}

/**
 * WHERE THE VALUE OF A RETURN GOES, in the order of the table above. `rest` is
 * «Por cobrar» less the value: the left-over the owner asked to see.
 */
export function planOfReturn(value: number, pendingOfFiado: number, otherFiados: OtherFiado[]) {
  const { own, leftOver } = splitOfReturn(value, pendingOfFiado);
  const { lines, rest } = spreadOverFiados(leftOver, otherFiados);
  return { own, lines, toFiados: round2(lines.reduce((sum, l) => sum + l.amount, 0)), rest };
}
