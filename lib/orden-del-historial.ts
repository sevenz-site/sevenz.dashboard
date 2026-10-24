// THE ORDER OF THE HISTORY, decided once for the two screens that draw it.
//
// ===========================================================================
// WHY THIS EXISTS, AND IT IS NOT A STYLE PREFERENCE
//
// The lines of a split payment are written in ONE transaction, and inside a
// transaction `now()` is the instant of the TRANSACTION — so every line of a
// reparto shares `created_at` down to the microsecond. CLAUDE.md already
// documents this for the running-balance trigger; here it bites somewhere
// else.
//
// `order by created_at desc` alone leaves those rows tied, and a tie has no
// defined order in Postgres: each query is free to return them however it
// likes. Measured in dev on 2026-10-23 with one payment of Bs. 20.000 split
// across three fiados:
//
//   owner's screen   €0.50 · $6.50 · €6.81 · €7.53
//   client's link    €0.50 · €7.53 · €6.81 · $6.50
//
// Same rows, same data, two orders. Nobody is losing money over it, but the
// shopkeeper and the client reading their phones side by side see the same
// payment in a different sequence — which is the one thing this product
// promises not to do.
//
// ===========================================================================
// WHY A TIEBREAK IN TYPESCRIPT AND NOT IN THE SQL
//
// The owner's list is a PostgREST query and the client's comes out of
// `get_shared_balance`, a 200-line SECURITY DEFINER function that would have
// to be dropped and recreated whole to add `, id desc` to two of its inner
// queries. Two fixes in two languages are two chances to drift apart, and the
// drift is exactly the bug.
//
// Here both screens call the same function, so they cannot disagree. The
// trade-off, stated: the RPC caps at 50 movements, so a tie sitting exactly
// on that boundary could still let a row in on one side and not the other.
// That needs the SQL fix, and it is a far smaller problem than the one this
// closes.
//
// The id is a random uuid, so it carries no meaning — it is a tiebreak, not
// an ordering. What matters is that it is the SAME arbitrary answer on both
// screens.

export type ConFechaEId = { created_at: string; id: string };

export function porFechaDescendente(a: ConFechaEId, b: ConFechaEId): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Sorts a copy, never the array it is given: both callers hold lists that
// other code reads afterwards.
export function ordenarHistorial<T extends ConFechaEId>(filas: readonly T[]): T[] {
  return [...filas].sort(porFechaDescendente);
}
