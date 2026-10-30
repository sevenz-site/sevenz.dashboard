"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizePartialCode } from "@/lib/transaction-code";

// THE SEARCH BOX OF INICIO, ASKED FOR A TRANSACTION INSTEAD OF A CLIENT.
//
// Owner's request of 2026-10-30, from user comments: «Buscar cliente» in the
// home screen should also find a transaction by its code. The client list is
// already in the browser, so filtering clients costs nothing; transactions are
// not, so this is the one place the box asks the server something.
//
// ===========================================================================
// A TRANSACTION IS NOT ONE ROW, AND THE ANSWER IS ONE PER CODE
//
// The code identifies what the shopkeeper DID once (see migration 147), and
// that is up to three different shapes: a sale (a `sales` row plus a movement
// per currency it left owing), a split payment (N movements sharing the code),
// or a lone movement. Returning one hit per ROW would show three results for one
// payment of Bs. 20.000 -- the very confusion the code exists to remove.
//
// WHERE EACH ONE OPENS, chosen to match what the history rows already do:
//
//   · a sale that left something owing -> its fiado, `/transacciones/<id>`.
//     A mixed sale (cash in one currency, fiado in another) opens the fiado;
//     its cash half is reached from the client's history, where it has its own
//     row. Opening the cash half instead would hide the debt.
//   · a sale paid in full -> `/transacciones/venta/<sale>/<currency>`. It wrote
//     no movement, so the sale is the only place its code lives.
//   · anything else -> that movement.
//
// ===========================================================================
// WHO MAY SEE WHAT: checked in code, and not only by RLS
//
// The query text arrives from the browser, and a code is a guessable space. A
// hit for another owner's transaction would be a leak, so every query is scoped
// to the signed-in owner explicitly -- through the client for `movements`,
// which carries no `owner_id`, and directly for `sales` -- the pattern
// CLAUDE.md asks for on any server action that takes an identifier or a
// lookup key from the browser.
//
// TRASHED CLIENTS AND DELETED ROWS ARE LEFT OUT, like the client search next to
// it: a code that finds something the owner cannot see anywhere else on the
// screen reads as a bug.

export type TransactionSearchResult = {
  code: string;
  kind: "fiado" | "abono" | "venta";
  clientName: string;
  href: string;
};

export type TransactionSearchResponse =
  | { results: TransactionSearchResult[] }
  | { error: string };

const RESULT_LIMIT = 5;

type Joined = { name: string } | { name: string }[] | null;
const nameOf = (joined: Joined): string =>
  (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? "";

export async function searchTransactionsByCode(
  query: string,
): Promise<TransactionSearchResponse> {
  // The same rule the box applies before asking. A text that cannot start a
  // code never reaches the database -- «Pedro» is a client, not a code.
  const code = normalizePartialCode(String(query ?? ""));
  if (!code) return { results: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // The prefix is letters and digits only, so it carries no `%` or `_` that
  // could widen the match.
  const prefix = `${code}%`;

  const [moves, sales] = await Promise.all([
    supabase
      .from("movements")
      .select("id, type, sale_id, created_at, transaction_code, clients!inner(name, owner_id, trashed_at)")
      .like("transaction_code", prefix)
      .eq("clients.owner_id", user.id)
      .is("clients.trashed_at", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("sales")
      .select("id, transaction_code, created_at, clients!inner(name, trashed_at)")
      .eq("owner_id", user.id)
      .like("transaction_code", prefix)
      .is("clients.trashed_at", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (moves.error || sales.error) {
    // The detail stays in the server log and never reaches the browser.
    console.error("[searchTransactionsByCode]", moves.error?.message ?? sales.error?.message);
    return { error: "No pudimos buscar transacciones ahora. Inténtalo de nuevo." };
  }

  type Move = {
    id: string;
    type: "charge" | "payment";
    sale_id: string | null;
    created_at: string;
    transaction_code: string;
    clients: Joined;
  };
  const movements = (moves.data ?? []) as unknown as Move[];
  const salesRows = (sales.data ?? []) as unknown as {
    id: string;
    transaction_code: string;
    created_at: string;
    clients: Joined;
  }[];

  // ── A SALE'S MOVEMENTS, EVEN WHEN THE PREFIX QUERY MISSED THEM ───────
  //
  // The prefix query above is capped, and a sale's movements share its code, so
  // they are normally in it. «Normally» is not what decides whether a sale is
  // paid in full, though: that is a statement about ALL its movements. Asked by
  // sale id, so a cap can never turn a fiado into a cash sale.
  const saleIds = salesRows.map((s) => s.id);
  const movesOfSales: Move[] = [...movements.filter((m) => m.sale_id && saleIds.includes(m.sale_id))];
  const unknown = saleIds.filter((id) => !movesOfSales.some((m) => m.sale_id === id));
  if (unknown.length > 0) {
    const { data, error } = await supabase
      .from("movements")
      .select("id, type, sale_id, created_at, transaction_code, clients!inner(name, owner_id)")
      .in("sale_id", unknown)
      .eq("clients.owner_id", user.id)
      .is("deleted_at", null);
    if (error) {
      console.error("[searchTransactionsByCode] sale movements:", error.message);
      return { error: "No pudimos buscar transacciones ahora. Inténtalo de nuevo." };
    }
    movesOfSales.push(...((data ?? []) as unknown as Move[]));
  }

  // The currency a cash-only sale's page is keyed by.
  const cashOnly = salesRows.filter((s) => !movesOfSales.some((m) => m.sale_id === s.id));
  const currencyOfSale = new Map<string, string>();
  if (cashOnly.length > 0) {
    const { data, error } = await supabase
      .from("sale_payments")
      .select("sale_id, currency")
      .in(
        "sale_id",
        cashOnly.map((s) => s.id),
      );
    if (error) {
      console.error("[searchTransactionsByCode] sale payments:", error.message);
      return { error: "No pudimos buscar transacciones ahora. Inténtalo de nuevo." };
    }
    for (const p of data ?? []) {
      const id = p.sale_id as string;
      if (!currencyOfSale.has(id)) currencyOfSale.set(id, String(p.currency ?? "").toLowerCase());
    }
  }

  // ── ONE RESULT PER CODE ──────────────────────────────────────────────
  const byCode = new Map<string, TransactionSearchResult & { at: string }>();

  for (const s of salesRows) {
    const own = movesOfSales.filter((m) => m.sale_id === s.id);
    const charge = own.filter((m) => m.type === "charge").sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const target = charge ?? own[0];
    if (target) {
      byCode.set(s.transaction_code, {
        code: s.transaction_code,
        kind: target.type === "charge" ? "fiado" : "abono",
        clientName: nameOf(s.clients),
        href: `/transacciones/${target.id}`,
        at: s.created_at,
      });
      continue;
    }
    const currency = currencyOfSale.get(s.id);
    if (!currency) continue;
    byCode.set(s.transaction_code, {
      code: s.transaction_code,
      kind: "venta",
      clientName: nameOf(s.clients),
      href: `/transacciones/venta/${s.id}/${currency}`,
      at: s.created_at,
    });
  }

  // Everything that is not part of a sale already handled above. Newest first,
  // so the first one seen for a split payment is the latest of its lines.
  for (const m of movements) {
    if (!m.transaction_code || byCode.has(m.transaction_code)) continue;
    byCode.set(m.transaction_code, {
      code: m.transaction_code,
      kind: m.type === "charge" ? "fiado" : "abono",
      clientName: nameOf(m.clients),
      href: `/transacciones/${m.id}`,
      at: m.created_at,
    });
  }

  const results = [...byCode.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RESULT_LIMIT)
    .map((r) => ({ code: r.code, kind: r.kind, clientName: r.clientName, href: r.href }));

  return { results };
}
