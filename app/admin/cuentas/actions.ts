"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/admin/guard";
import { cambiarPlan, darDemo, registrarPago, type Periodicidad } from "@/lib/admin/subscriptions";

// Cada acción vuelve a pasar por requireSuperadmin(), aunque el layout ya lo
// haga.
//
// No es redundante: una acción de servidor es un endpoint POST que cualquiera
// puede llamar con un fetch, sin pasar jamás por el layout que la rodea en
// pantalla. El guardia del layout protege lo que se DIBUJA; esto protege lo
// que se EJECUTA, y aquí lo que se ejecuta es regalar meses de producto.
//
// Es la misma regla de CLAUDE.md que ya mordió dos veces en getOrCreateShareLink
// y confirmImport: comprobar en el servidor, no confiar en la pantalla.

export type AccionState = { error: string | null; ok: boolean };

export async function accionDarDemo(
  _prev: AccionState,
  formData: FormData,
): Promise<AccionState> {
  const { email } = await requireSuperadmin();

  const ownerId = String(formData.get("owner_id") ?? "");
  const dias = Number(formData.get("dias") ?? 0);
  const notas = String(formData.get("notas") ?? "").trim() || null;
  const precioRaw = String(formData.get("precio") ?? "").trim();
  const periodicidadRaw = String(formData.get("periodicidad") ?? "");

  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    return { error: "Los días de la demo tienen que ir de 1 a 365.", ok: false };
  }

  // Vacío = todavía no se habló de precio, que es distinto de gratis.
  const precio = precioRaw === "" ? null : Number(precioRaw);
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    return { error: "El precio no es un número válido.", ok: false };
  }
  const periodicidad: Periodicidad | null =
    periodicidadRaw === "mensual" || periodicidadRaw === "trimestral" || periodicidadRaw === "anual"
      ? periodicidadRaw
      : null;

  const { error } = await darDemo(ownerId, dias, email, notas, precio, periodicidad);
  if (error) return { error, ok: false };

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true };
}

export async function accionCambiarPlan(
  _prev: AccionState,
  formData: FormData,
): Promise<AccionState> {
  const { email } = await requireSuperadmin();

  const ownerId = String(formData.get("owner_id") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const periodicidadRaw = String(formData.get("periodicidad") ?? "");
  const precioRaw = String(formData.get("precio") ?? "").trim();
  const notas = String(formData.get("notas") ?? "").trim() || null;

  if (!ownerId || !plan) return { error: "Falta el negocio o el plan.", ok: false };

  const periodicidad: Periodicidad | null =
    periodicidadRaw === "mensual" || periodicidadRaw === "trimestral" || periodicidadRaw === "anual"
      ? periodicidadRaw
      : null;

  // Vacío significa "el del catálogo", no cero. Un precio de cero en un plan de
  // pago sería un regalo silencioso, y regalar tiene su propio plan.
  const precio = precioRaw === "" ? null : Number(precioRaw);
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    return { error: "El precio no es un número válido.", ok: false };
  }

  const { error } = await cambiarPlan(ownerId, plan, email, periodicidad, precio, notas);
  if (error) return { error, ok: false };

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true };
}

export async function accionRegistrarPago(
  _prev: AccionState,
  formData: FormData,
): Promise<AccionState> {
  const { email } = await requireSuperadmin();

  const ownerId = String(formData.get("owner_id") ?? "");
  const monto = Number(formData.get("monto") ?? 0);
  const metodo = String(formData.get("metodo") ?? "").trim();
  const hasta = String(formData.get("hasta") ?? "");
  const notas = String(formData.get("notas") ?? "").trim() || null;

  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "El monto tiene que ser mayor que cero.", ok: false };
  }
  if (!metodo) return { error: "Di cómo pagó.", ok: false };
  if (!hasta) return { error: "Falta hasta cuándo cubre el pago.", ok: false };

  // El input date da YYYY-MM-DD. Se cierra al final de ese día en Caracas, por
  // el mismo motivo que la demo: un pago que cubre "hasta el 15" cubre el 15
  // entero, no hasta las 00:00 de ese día.
  const hastaIso = new Date(`${hasta}T23:59:59-04:00`).toISOString();

  const { error } = await registrarPago(ownerId, monto, metodo, hastaIso, email, notas);
  if (error) return { error, ok: false };

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true };
}
