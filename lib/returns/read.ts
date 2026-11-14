import type { SupabaseClient } from "@supabase/supabase-js";
import { lineaDelLibro, type SaleLineRow } from "@/lib/sale-lines";
import type { LedgerCurrency } from "@/lib/types";
import type { OtherFiado } from "@/lib/returns/options";

// A RETURN, AS THE SCREENS READ IT. The same keys `get_shared_balance` builds
// for the client's link (migration 185), so both faces draw one shape.
//
// `amount` is the VALUE of what came back. A movement's `amount` is only what
// moved the ledger, which is less when part of it was handed back in cash, and
// can be zero. The history prints the value: that is what the shopkeeper did.
export type ReturnSummary = {
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  to_own: number;
  to_fiados: number;
  to_credit: number;
  to_cash: number;
  // Null for a return of a sale paid in full (migration 186).
  charge_movement_id: string | null;
  sale_id: string;
};

/**
 * What is left of this book of a sale: what was charged and collected, less what
 * already came back. The same sum as the functions, which check it again.
 */
export async function ceilingOfBook(
  supabase: SupabaseClient,
  saleId: string,
  currency: LedgerCurrency | null,
  chargeAmount: number,
): Promise<number> {
  const [{ data: payments }, { data: returns }] = await Promise.all([
    supabase.from("sale_payments").select("amount, currency").eq("sale_id", saleId),
    supabase.from("sale_returns").select("amount, currency").eq("sale_id", saleId).is("deleted_at", null),
  ]);
  const inBook = (c: string | null) => (c === "USD" || c === "EUR" ? c : null) === currency;
  const sum = (rows: { amount: unknown; currency: string | null }[] | null) =>
    (rows ?? []).filter((r) => inBook(r.currency)).reduce((total, r) => total + Number(r.amount), 0);
  return chargeAmount + sum(payments) - sum(returns);
}

/** The book as the «Por cobrar» card reads it, signed: below zero is in favour. */
export async function bookBalance(
  supabase: SupabaseClient,
  clientId: string,
  currency: LedgerCurrency | null,
): Promise<number> {
  const { data } = await supabase
    .from("client_summary_all")
    .select("balance, balance_usd, balance_eur")
    .eq("client_id", clientId)
    .maybeSingle();
  const value = currency === "USD" ? data?.balance_usd : currency === "EUR" ? data?.balance_eur : data?.balance;
  return Number(value ?? 0);
}

/** The open fiados of one book, as the return popups read them. */
export function otherFiadosOf(
  open: { movement_id: string; pending: number; charge_at: string; currency: LedgerCurrency | null; description: string | null }[],
  currency: LedgerCurrency | null,
  exceptId: string | null,
): OtherFiado[] {
  return open
    .filter((c) => c.movement_id !== exceptId && (c.currency ?? null) === (currency ?? null))
    .map((c) => ({
      id: c.movement_id,
      pending: Number(c.pending),
      chargeAt: c.charge_at,
      title: c.description || "Fiado",
    }));
}

type WithGroup = { type: string; payment_group_id?: string | null };

/** Hangs each return's summary on its ledger rows. One query, only if needed. */
export async function withReturns<T extends WithGroup>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<(T & { devolucion?: ReturnSummary })[]> {
  const ids = [
    ...new Set(
      rows.filter((r) => r.type === "return" && r.payment_group_id).map((r) => r.payment_group_id as string),
    ),
  ];
  if (ids.length === 0) return rows;

  const { data, error } = await supabase
    .from("sale_returns")
    .select("id, product_name, quantity, unit_price, amount, to_own, to_fiados, to_credit, to_cash, charge_movement_id, sale_id")
    .in("id", ids);
  if (error) {
    // A label is missing, the money is not: the row still draws from `movements`.
    console.error("[returns] could not read the returns:", error.message);
    return rows;
  }

  const byId = new Map(
    (data ?? []).map((r) => [
      r.id as string,
      {
        product_name: r.product_name as string,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
        amount: Number(r.amount),
        to_own: Number(r.to_own),
        to_fiados: Number(r.to_fiados),
        to_credit: Number(r.to_credit),
        to_cash: Number(r.to_cash),
        charge_movement_id: (r.charge_movement_id as string | null) ?? null,
        sale_id: r.sale_id as string,
      } satisfies ReturnSummary,
    ]),
  );

  return rows.map((r) => {
    const devolucion = r.payment_group_id ? byId.get(r.payment_group_id) : undefined;
    return devolucion ? { ...r, devolucion } : r;
  });
}

/** The route segment of a book in `/transacciones/venta` and `/s/.../v`. */
export const bookSegment = (currency: string | null) => currency?.toLowerCase() ?? "cop";

/** How many units of each line came back, for the products of a fiado. */
export async function returnedByLine(
  supabase: SupabaseClient,
  lineIds: string[],
): Promise<Map<string, { quantity: number; value: number }>> {
  const out = new Map<string, { quantity: number; value: number }>();
  if (lineIds.length === 0) return out;
  const { data } = await supabase
    .from("sale_returns")
    .select("sale_line_id, quantity, amount")
    .in("sale_line_id", lineIds)
    .is("deleted_at", null);
  for (const r of data ?? []) {
    const id = r.sale_line_id as string;
    const line = out.get(id) ?? { quantity: 0, value: 0 };
    out.set(id, { quantity: line.quantity + Number(r.quantity), value: line.value + Number(r.amount) });
  }
  return out;
}

// The lines of one book of a sale, with what the «⋮» of each needs.
export async function lineasDe(
  supabase: SupabaseClient,
  saleId: string | null,
  moneda: LedgerCurrency | null,
): Promise<SaleLineRow[]> {
  if (!saleId) return [];
  const { data } = await supabase
    .from("sale_lines")
    // `id` AND THE SHELF, for the «⋮» of each product (migration 185).
    .select("id, name, quantity, unit_price, currency, products(stock_opening)")
    .eq("sale_id", saleId);
  // NORMALISED: `sale_lines` spells the Colombian book 'COP' and `movements`
  // spells it NULL, so comparing the raw columns found no line at all for a
  // Colombian fiado, which the «⋮» depends on. The rule lives in
  // `lib/sale-lines.ts` since 2026-11-13, shared with every screen that names a fiado.
  const lineas = (data ?? []).filter((l) => lineaDelLibro(l.currency as string | null, moneda));
  const devueltas = await returnedByLine(
    supabase,
    lineas.map((l) => l.id as string),
  );
  return lineas.map((l) => ({
    id: l.id as string,
    name: l.name as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    devuelto: devueltas.get(l.id as string)?.quantity ?? 0,
    devueltoValor: devueltas.get(l.id as string)?.value ?? 0,
    stockCounted:
      (l.products as unknown as { stock_opening: number | null } | null)?.stock_opening != null,
  }));
}
