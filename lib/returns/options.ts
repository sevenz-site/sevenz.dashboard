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

// HOW IT REACHES THE SCREEN: ONE POPUP, owner's decision of 2026-11-04 (section
// `1988:16553` and frames `1988:16505`, `1988:17547`): *«sinteticemos todo a una
// modal»*. Until that day a left-over opened a second popup. The options are now
// buttons of the first one, and each says what it does in the notice above it.
//
//   Cash sale, nothing owed        | Saldo a favor, or cash
//   Cash sale, owes less than value| Abonar y devolver, abonar y dejar, or all cash
//   Cash sale, owes value or more  | Abonar, or all cash
//   Mostrador                      | Cash
//   Fiado, nothing left over       | One button: «Descontar», the fiados go down
//   Fiado, something left over     | Saldo a favor, or that left-over in cash
//
// A FIADO NEVER HANDS BACK MORE THAN WAS HANDED OVER, owner's rule of 2026-11-04:
// *«al cliente no se le puede devolver más dinero de lo que entregó porque el dueño
// estaría perdiendo plata»*. The left-over is what guarantees it, measured in
// `qa:devoluciones-contado`: the value is capped at `charge + payments at the sale
// - returned` (188) and the fiado owes `charge - abonos - returned`, so value less
// debt is at most what was paid. A fiado nobody paid leaves nothing over: its last
// units are worth what is left of it.
//
// THE CASH BUTTON WAS OUT FOR A FEW HOURS THE SAME DAY. His note on frame
// `1988:17547` read *«Devolver dinero no debería aplicar (...) porque fué un fiado,
// el cliente nunca entregó dinero»*. Shown the measurement he decided: *«Ofrecer
// devolver el efectivo que sobre en un fiado»*. What it cost to leave out: a client
// who paid $30 in abonos could only hold a saldo, and cash handed over outside the
// app would leave that saldo alive to be spent.
//
// «DEVOLVER» WITH A FIGURE MEANS CASH LEAVES THE TILL, everywhere: owner's decision
// of 2026-11-04. His frames drew «Devolver $10,00» on a fiado where nothing leaves.
// The worst case was a client who paid $10, owes $25 on another fiado and says
// «dame mis $10»: the shopkeeper hands them over and the debt falls as well, $10
// lost. So that button reads «Descontar», and the notice says no money goes out.
//
// «WHAT IS LEFT OVER» IS AFTER ALL THE DEBTS, unlike a cash sale: a fiado already
// paid, with another owing $25, abona solo. Owner's decision of 2026-11-04, asked
// by name: that client paid real money too, but still owes more than comes back,
// and cash would leave the till for someone in debt.

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

export type ReturnChoice = {
  kind: "a_favor" | "devolver" | "devolver_sobrante" | "descontar" | "abonar" | "abonar_y_devolver" | "abonar_y_dejar";
  fiados: { fiado_id: string; amount: number }[];
  aFavor: number;
  efectivo: number;
};

/**
 * THE BUTTONS OF A CASH SALE WITH A CLIENT, in the order the frames draw them. All
 * the money really was paid, so handing it back whole is always one of them, even
 * to a client who owes: owner's frames of 2026-11-04 (`1988:16384`, `1987:16273`).
 */
export function choicesOfCashSale(value: number, otherFiados: OtherFiado[]): ReturnChoice[] {
  const { lines, toFiados, rest } = planOfReturn(value, 0, otherFiados);
  const allInCash: ReturnChoice = { kind: "devolver", fiados: [], aFavor: 0, efectivo: value };
  if (toFiados <= 0) return [{ kind: "a_favor", fiados: [], aFavor: value, efectivo: 0 }, allInCash];
  if (rest <= 0) return [{ kind: "abonar", fiados: lines, aFavor: 0, efectivo: 0 }, allInCash];
  return [
    { kind: "abonar_y_devolver", fiados: lines, aFavor: 0, efectivo: rest },
    { kind: "abonar_y_dejar", fiados: lines, aFavor: rest, efectivo: 0 },
    allInCash,
  ];
}

/**
 * THE BUTTONS OF A FIADO: one when nothing is left over, as frame `1988:16505` draws
 * it, and with a left-over the saldo or that same left-over in cash. `efectivo` can
 * only ever be `rest`: see the rule at the top of this file.
 */
export function choicesOfFiado(value: number, pendingOfFiado: number, otherFiados: OtherFiado[]): ReturnChoice[] {
  const { lines, rest } = planOfReturn(value, pendingOfFiado, otherFiados);
  if (rest <= 0) return [{ kind: "descontar", fiados: lines, aFavor: 0, efectivo: 0 }];
  return [
    { kind: "a_favor", fiados: lines, aFavor: rest, efectivo: 0 },
    { kind: "devolver_sobrante", fiados: lines, aFavor: 0, efectivo: rest },
  ];
}
