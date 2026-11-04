"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { mensajeDeError } from "@/lib/errores-legibles";

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
};

export async function registrarDevolucion(
  input: ReturnInput,
): Promise<{ ok: true; movementId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: REFUSALS.sin_sesion };

  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const { data: fiado } = await supabase
    .from("movements")
    .select("id, client_id, clients!inner(owner_id)")
    .eq("id", input.movementId)
    .eq("clients.owner_id", user.id)
    .eq("type", "charge")
    .is("deleted_at", null)
    .maybeSingle();
  if (!fiado) return { ok: false, error: REFUSALS.fiado_ajeno };

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: REFUSALS.cantidad_invalida };
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
    return { ok: false, error: mensajeDeError("registrar la devolución", error, "registrarDevolucion") };
  }

  const result = data as { ok: boolean; code?: string; movement_id?: string };
  if (!result.ok) {
    return {
      ok: false,
      error: REFUSALS[result.code ?? ""] ?? "No pudimos registrar la devolución. Vuelve a intentarlo.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/productos");
  revalidatePath(`/clients/${fiado.client_id}`);
  revalidatePath(`/transacciones/${input.movementId}`);
  return { ok: true, movementId: result.movement_id as string };
}
