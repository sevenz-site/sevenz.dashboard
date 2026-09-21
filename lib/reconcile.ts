import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";

// Por qué una fila pide una segunda mirada. Eran tres cosas muy distintas
// metidas en el mismo booleano, y la pantalla las explicaba todas con la misma
// frase — "no cuadra con el saldo escrito en tu libreta" —, que es falsa en dos
// de los tres casos.
//
//   "no_cuadra"       el saldo escrito a mano NO coincide con el calculado.
//                     La única que de verdad significa "revisa esta cuenta", y
//                     la única que se pinta en rojo.
//   "sin_saldo"       esa línea no traía ningún saldo escrito. No es que no
//                     cuadre: es que no había nada con qué comparar, y en un
//                     cuaderno a mano es lo NORMAL — casi nadie apunta el total
//                     corrido en cada renglón. Marcar esto en rojo pintaba una
//                     libreta entera de rojo y no distinguía nada.
//   "lectura_dudosa"  la IA no se fio de lo que leyó en esa línea.
export type ReviewReason = "no_cuadra" | "lectura_dudosa" | "sin_saldo";

export type ReviewRow = ExtractedMovement & {
  rowId: string;
  matched_client_id: string | null;
  computed_balance: number;
  needs_review: boolean;
  // Null cuando la fila está bien. Cuando no, el motivo concreto, para que la
  // tabla pueda decir cuál es en vez de un color sin explicación.
  review_reason: ReviewReason | null;
  // True when there's no existing client on file with a document_id for
  // this row — either it's a brand-new client, or it matched an existing
  // one that's never had a cédula/documento recorded. False (no need to
  // ask again) when the matched client already has one.
  needs_document_id: boolean;
};

const RECONCILE_TOLERANCE = 1;

export type ReconcileClient = {
  id: string;
  name: string;
  // The currency-less COP balance. Meaningful for a CO owner; for a VE owner
  // the two below are the real ones.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  document_id: string | null;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// The running balance is per client AND per currency, never per client alone.
//
// A VE owner's $50 and €20 are two independent debts, not one debt seen two
// ways — the rule the whole app follows. One accumulator per client would add
// them together, and the damage would be silent: "Saldo calculado" would show
// a plausible number, and the read_balance comparison below would raise
// "Revisar" on rows that are fine while passing rows that are not. A broken
// check that looks like a working one is worse than no check.
function balanceKey(name: string, currency: LedgerCurrency | null): string {
  return `${normalizeName(name)}|${currency ?? "COP"}`;
}

function seedBalance(client: ReconcileClient, currency: LedgerCurrency | null): number {
  if (currency === "USD") return client.balance_usd;
  if (currency === "EUR") return client.balance_eur;
  return client.balance;
}

export function reconcileMovements(
  extracted: ExtractedMovement[],
  existingClients: ReconcileClient[],
): ReviewRow[] {
  const byName = new Map(existingClients.map((c) => [normalizeName(c.name), c]));
  // Seeded lazily on first use rather than pre-filled, so a client only gets a
  // starting balance for the currencies their rows actually mention.
  const runningBalances = new Map<string, number>();

  return extracted.map((movement, index) => {
    const nameKey = normalizeName(movement.client_name);
    const matched = byName.get(nameKey);
    const key = balanceKey(movement.client_name, movement.currency);
    const prevBalance =
      runningBalances.get(key) ?? (matched ? seedBalance(matched, movement.currency) : 0);
    const delta = movement.type === "charge" ? movement.amount : -movement.amount;
    const computedBalance = prevBalance + delta;
    runningBalances.set(key, computedBalance);

    const reconciles =
      movement.read_balance !== null &&
      Math.abs(movement.read_balance - computedBalance) <= RECONCILE_TOLERANCE;

    return {
      ...movement,
      // The uid assigned when the batch entered review, never the name and
      // never the currency.
      //
      // This is a React key, so anything in it the owner can edit turns an edit
      // into a remount: the row becomes a different element, its inputs are
      // rebuilt and focus is lost mid-keystroke. The shared-client field
      // rewrites every row's name on each keystroke, which by name would have
      // remounted the whole table per character.
      //
      // Position would survive that but not deletion: removing a row shifts
      // every index above it, so React would reuse the wrong element and the
      // set of rows opted out of the shared client would move to their
      // neighbours. Falls back to the index only for a caller that supplies no
      // uid.
      rowId: movement.uid ?? String(index),
      matched_client_id: matched?.id ?? null,
      computed_balance: computedBalance,
      needs_review: movement.confidence === "low" || movement.read_balance === null || !reconciles,
      // El orden importa: se queda con el motivo MÁS accionable. Un desajuste
      // real trae dos cifras que el dueño puede comparar con el cuaderno
      // delante; "no me fie de la lectura" solo le dice que mire. Si se dan
      // los dos, gana el que se puede resolver.
      review_reason:
        movement.read_balance !== null && !reconciles
          ? "no_cuadra"
          : movement.confidence === "low"
            ? "lectura_dudosa"
            : movement.read_balance === null
              ? "sin_saldo"
              : null,
      needs_document_id: !matched?.document_id,
    };
  });
}
