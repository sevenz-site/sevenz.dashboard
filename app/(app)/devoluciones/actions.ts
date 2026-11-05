"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { mensajeDeError } from "@/lib/errores-legibles";
import { trackServer } from "@/lib/mixpanel-server";
import { flowContext, moneyProps, type FlowInput } from "@/lib/analytics/amounts";
import type { FlowContext, ReturnRejectionReason } from "@/lib/analytics/events";

// REGISTERING A RETURN. All the rules live in `registrar_devolucion` (migration
// 185), the one place that can write the ledger, the shelf and the event
// together. What this action adds is a sentence per refusal.
//
// THE OWNERSHIP CHECK IS EXPLICIT TOO, before the call, as CLAUDE.md asks of
// every id that arrives from the browser. The function checks again with its
// own rights: this is the sentence, that is the lock.

export type ReturnInput = {
  movementId: string;
  lineId: string;
  quantity: number;
  // Only what was left over. See `lib/returns/options.ts` for when each applies.
  fiados: { fiado_id: string; amount: number }[];
  aFavor: number;
  efectivo: number;
  // Which attempt this is. Only for the funnels.
  analitica?: FlowInput;
};

const REFUSALS: Record<string, string> = {
  sin_sesion: "Tu sesión se cerró. Vuelve a entrar.",
  cuenta_pausada: MENSAJE_CUENTA_PAUSADA,
  cantidad_invalida: "Revisa la cantidad.",
  fiado_ajeno: "No encontramos ese fiado.",
  sin_productos: "Este fiado no tiene productos que devolver.",
  venta_eliminada: "Esa venta ya no existe.",
  linea_ajena: "No encontramos ese producto en este fiado.",
  excede_la_cantidad: "Ya se devolvieron esas unidades. Revisa la cantidad.",
  excede_la_venta: "La devolución supera lo que valió esta venta.",
  sin_valor: "Este producto no tiene valor que devolver.",
  fiado_saldado: "Uno de esos fiados ya está saldado. Vuelve a intentarlo.",
  excede_el_fiado: "Uno de esos fiados debe menos de lo que le ibas a abonar. Vuelve a intentarlo.",
  reparto_no_cuadra: "La cuenta de lo que sobra cambió. Vuelve a intentarlo.",
  hay_deuda_en_esa_moneda: "Este cliente tiene deuda en esa moneda, así que no puede quedar a favor.",
  venta_ajena: "No encontramos esa venta.",
  tiene_fiado: "Esta parte de la venta quedó fiada. Registra la devolución desde su fiado.",
  sin_cliente: "Una venta sin cliente no puede dejar saldo a favor.",
};

const REASON_OF_RPC_CODE: Record<string, ReturnRejectionReason> = {
  cuenta_pausada: "paused_account",
  cantidad_invalida: "invalid_quantity",
  fiado_ajeno: "not_found",
  sin_productos: "no_products",
  venta_eliminada: "sale_deleted",
  linea_ajena: "not_found",
  excede_la_cantidad: "quantity_exceeded",
  excede_la_venta: "sale_value_exceeded",
  sin_valor: "no_value",
  fiado_saldado: "fiado_settled",
  excede_el_fiado: "exceeds_fiado",
  reparto_no_cuadra: "split_mismatch",
  hay_deuda_en_esa_moneda: "debt_in_currency",
  venta_ajena: "not_found",
  tiene_fiado: "has_fiado",
  sin_cliente: "no_client",
};

type ReturnResult = { ok: true; movementId: string } | { ok: false; error: string };

// WHY A RETURN DID NOT SAVE. The flow launched in v0.2.0 with cases nobody has
// walked in production, pesos among them, so a refusal that keeps coming back is
// the first sign of a case that needs looking at. Filed under the owner.
function refuse(
  ownerId: string,
  email: string | undefined,
  context: FlowContext & { sale_kind: "fiado" | "cash" },
  reason: ReturnRejectionReason,
  error: string,
): ReturnResult {
  trackServer("Return Rejected", ownerId, { ...context, reason }, email);
  return { ok: false, error };
}

// HOW MANY RETURNS THERE ARE AND WHERE THE MONEY WENT. Owner's request of
// 2026-11-04: *«Todas las transacciones deben tener eventos»*. It decides where
// the next return work goes: mostly fiado or mostly cash, and whether shopkeepers
// hand money back or leave it as saldo. Everything comes from what the function
// wrote, never from what the browser asked for. Filed under the owner.
async function recordReturn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  email: string | undefined,
  context: FlowContext & { sale_kind: "fiado" | "cash" },
  input: { lineId: string; quantity: number },
  clientId: string,
  result: RpcResult,
) {
  const { data: line } = await supabase.from("sale_lines").select("currency").eq("id", input.lineId).maybeSingle();
  const currency = (line?.currency as string | null | undefined) ?? null;
  trackServer(
    "Return Recorded",
    ownerId,
    {
      ...context,
      return_id: result.return_id ?? null,
      movement_id: result.movement_id ?? null,
      client_id: clientId,
      quantity: input.quantity,
      ...moneyProps("value", [[currency, Number(result.amount ?? 0)]]),
      ...moneyProps("to_own", [[currency, Number(result.to_own ?? 0)]]),
      ...moneyProps("to_fiados", [[currency, Number(result.to_fiados ?? 0)]]),
      ...moneyProps("to_credit", [[currency, Number(result.to_credit ?? 0)]]),
      ...moneyProps("to_cash", [[currency, Number(result.to_cash ?? 0)]]),
    },
    email,
  );
}

export async function registrarDevolucion(
  input: ReturnInput,
): Promise<ReturnResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: REFUSALS.sin_sesion };

  const context = { ...flowContext(input.analitica), sale_kind: "fiado" as const };
  const rechazar = (reason: ReturnRejectionReason, error: string) =>
    refuse(user.id, user.email, context, reason, error);

  if (!(await puedeEscribir(supabase, user.id))) {
    return rechazar("paused_account", MENSAJE_CUENTA_PAUSADA);
  }

  const { data: fiado } = await supabase
    .from("movements")
    .select("id, client_id, clients!inner(owner_id)")
    .eq("id", input.movementId)
    .eq("clients.owner_id", user.id)
    .eq("type", "charge")
    .is("deleted_at", null)
    .maybeSingle();
  if (!fiado) return rechazar("not_found", REFUSALS.fiado_ajeno);

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return rechazar("invalid_quantity", REFUSALS.cantidad_invalida);
  }

  const { data, error } = await supabase.rpc("registrar_devolucion", {
    p_movement_id: input.movementId,
    p_line_id: input.lineId,
    p_quantity: input.quantity,
    p_fiados: input.fiados,
    p_a_favor: input.aFavor,
    p_efectivo: input.efectivo,
  });

  if (error) {
    return rechazar("db_error", mensajeDeError("registrar la devolución", error, "registrarDevolucion"));
  }

  const result = data as RpcResult;
  if (!result.ok) return rechazar(REASON_OF_RPC_CODE[result.code ?? ""] ?? "db_error", refusalOf(result));

  revalidatePath("/dashboard");
  revalidatePath("/productos");
  revalidatePath(`/clients/${fiado.client_id}`);
  revalidatePath(`/transacciones/${input.movementId}`);
  await recordReturn(supabase, user.id, user.email, context, input, fiado.client_id as string, result);
  return { ok: true, movementId: result.movement_id as string };
}

type RpcResult = {
  ok: boolean;
  code?: string;
  movement_id?: string;
  return_id?: string;
  amount?: number;
  to_own?: number;
  to_fiados?: number;
  to_credit?: number;
  to_cash?: number;
};

const refusalOf = (result: RpcResult) =>
  REFUSALS[result.code ?? ""] ?? "No pudimos registrar la devolución. Vuelve a intentarlo.";

// THE SAME THING FOR A SALE PAID IN FULL (migration 186). A function of its own
// because there is no fiado to start from: everything hangs from the sale.
export async function registrarDevolucionDeContado(
  input: Omit<ReturnInput, "movementId"> & { saleId: string },
): Promise<ReturnResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: REFUSALS.sin_sesion };

  const context = { ...flowContext(input.analitica), sale_kind: "cash" as const };
  const rechazar = (reason: ReturnRejectionReason, error: string) =>
    refuse(user.id, user.email, context, reason, error);

  if (!(await puedeEscribir(supabase, user.id))) {
    return rechazar("paused_account", MENSAJE_CUENTA_PAUSADA);
  }

  const { data: venta } = await supabase
    .from("sales")
    .select("id, client_id")
    .eq("id", input.saleId)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!venta) return rechazar("not_found", REFUSALS.venta_ajena);

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return rechazar("invalid_quantity", REFUSALS.cantidad_invalida);
  }

  const { data, error } = await supabase.rpc("registrar_devolucion_contado", {
    p_sale_id: input.saleId,
    p_line_id: input.lineId,
    p_quantity: input.quantity,
    p_fiados: input.fiados,
    p_a_favor: input.aFavor,
    p_efectivo: input.efectivo,
  });

  if (error) {
    return rechazar("db_error", mensajeDeError("registrar la devolución", error, "registrarDevolucionDeContado"));
  }

  const result = data as RpcResult;
  if (!result.ok) return rechazar(REASON_OF_RPC_CODE[result.code ?? ""] ?? "db_error", refusalOf(result));

  revalidatePath("/dashboard");
  revalidatePath("/productos");
  revalidatePath(`/clients/${venta.client_id}`);
  await recordReturn(supabase, user.id, user.email, context, input, venta.client_id as string, result);
  return { ok: true, movementId: result.movement_id as string };
}
