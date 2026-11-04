// WHAT A RETURN DOES WITH THE MONEY, for the screen. Owner's decisions of
// 2026-11-03; `registrar_devolucion` (migration 185) enforces the same rules
// and is the one that decides. This file exists so the modal can say the
// consequences BEFORE the shopkeeper presses anything.
//
// ===========================================================================
// BY CURRENCY, WHETHER SOMETHING IS LEFT OVER, AND WHAT IS OFFERED
//
// The value of a return is `quantity x unit_price`. It lowers its own fiado
// first. What is left over is money the client ALREADY PAID, and only then is
// there anything to ask. Everything below is read per currency: a client's
// balance is one number per book.
//
//   Situation, in that currency             | Left over | What is offered
//   ----------------------------------------|-----------|----------------------
//   That fiado owes at least the value      | Nothing   | No question
//   Left over, other fiados owe             | Yes       | Abono to them, or cash
//   Left over, nothing else owed            | Yes       | Saldo a favor, or cash
//   Abono to fiados and there is still more | Yes       | Saldo a favor, or cash
//
// Worked example, always the same client: fiado A owes $5, a product of $10 is
// returned from it. A is settled with $5 and $5 are left over.
//
//   Fiado B owes $20  → abono: A $0, B $15, «Por cobrar» $15.
//                     → cash:  A $0, B $20, «Por cobrar» $20, $5 leave the till.
//   B owes only $3    → abono: B $0, and the $2 still left ask again.
//   Nothing else owed → a favor: book at -$5, chip «A favor».
//                     → cash:    book at $0, $5 leave the till.
//   Fully paid fiado, nothing else owed, returns $10: all $10 are left over.
//
// WHY EACH ROW IS THE WAY IT IS
//
//   · NOTHING LEFT OVER, NO QUESTION. The client paid nothing for that product.
//     Offering «Entregar en efectivo» would hand out money the shop never
//     received, which is the worst thing this screen could do.
//   · SALDO A FAVOR ONLY WITH NO DEBT IN THAT CURRENCY. Owing $20 with $5 in
//     favour can only print «Por cobrar $15»: the abono option without choosing
//     the fiado. So it is simply not offered there.
//   · ABONO ONLY TO FIADOS OF THE SAME CURRENCY. A dollar left-over does not pay
//     a euro fiado: owner's ruling of 2026-10-22, «a rate nobody agreed on». A
//     debt in the OTHER currency changes nothing in this table. The exception of
//     2026-10-23 was for bolivares handed over, not for this.
//   · CASH IS ALWAYS OFFERED when something is left over. It is the one choice
//     that does not depend on the debts, and it may be chosen with debts alive:
//     the modal says so instead of forbidding it.
//   · A COLOMBIAN BUSINESS HAS ONE BOOK (currency null), so the table is the
//     same with one column less to think about. Compare with `===` on the
//     ledger's own spelling, never against 'COP'.

// A SALE PAID IN FULL IS THE SAME TABLE (migration 186, owner's request of
// 2026-11-04): a fiado that owes nothing, so all of its value is left over and
// the second popup always comes. Its worked example is at the top of that file.
// One row more: a sale with no client (Mostrador) has nobody to hold a saldo a
// favor, so the money goes back and there is nothing to ask.

// HOW IT REACHES THE SCREEN (sitemap `1976:16103`): with nothing left over, one
// popup. With something left over, a second popup asks, and its first button
// depends on this table: «Abonar a otros fiados» with other fiados owing in that
// currency, «Registrar como saldo a favor» without them. «Devolver dinero» is the
// cash, always there. See `components/dashboard/registrar-devolucion-dialog.tsx`.

export type ReturnChoice = "fiados" | "a_favor" | "efectivo";

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

export function splitOfReturn(value: number, pendingOfFiado: number) {
  const own = round2(Math.min(value, pendingOfFiado));
  const leftOver = round2(value - own);
  return leftOver < TOLERANCE ? { own: round2(value), leftOver: 0 } : { own, leftOver };
}

/**
 * WHAT «POR COBRAR» WILL SAY AFTER EACH ANSWER, for the yellow notice. Owner's
 * request of 2026-11-04: the notice has to say what happens to the value and to
 * «Por cobrar», on a fiado and on a cash sale.
 *
 * `balance` is signed and comes from `client_summary`, the same figure as the
 * card: a client who already has money in favour is below zero, and counting
 * from the debts alone would promise a «$0,00» the card will not show.
 *
 * `afterOwn` is what is left with nothing more done: the end of the story when
 * nothing is left over, and what handing the money back leaves when something
 * is. The other two exist only where the table above offers them.
 */
export function bookAfter(balance: number, own: number, leftOver: number, otherDebt: number) {
  const afterOwn = round2(balance - own);
  const owes = otherDebt > TOLERANCE;
  return {
    afterOwn,
    afterAbono: owes ? round2(afterOwn - Math.min(leftOver, otherDebt)) : null,
    afterCredit: owes ? null : round2(afterOwn - leftOver),
  };
}

/** What is offered for a left-over, given the fiados still open in this book. */
export function choicesFor(leftOver: number, otherDebt: number): ReturnChoice[] {
  if (leftOver < TOLERANCE) return [];
  return otherDebt > TOLERANCE ? ["fiados", "efectivo"] : ["a_favor", "efectivo"];
}

/** A left-over spread over the fiados, oldest first, or over only one of them. */
export function spreadOverFiados(
  leftOver: number,
  fiados: OtherFiado[],
  onlyId: string | null,
): { lines: { fiado_id: string; amount: number }[]; rest: number } {
  const targets = onlyId
    ? fiados.filter((f) => f.id === onlyId)
    : [...fiados].sort((a, b) => a.chargeAt.localeCompare(b.chargeAt));
  const lines: { fiado_id: string; amount: number }[] = [];
  let rest = round2(leftOver);
  for (const f of targets) {
    if (rest < TOLERANCE) break;
    const amount = round2(Math.min(f.pending, rest));
    if (amount <= 0) continue;
    lines.push({ fiado_id: f.id, amount });
    rest = round2(rest - amount);
  }
  return { lines, rest: rest < TOLERANCE ? 0 : rest };
}
