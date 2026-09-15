"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/admin/guard";
import {
  bloquear,
  borrarComprobante,
  cambiarPlan,
  darDemo,
  desbloquear,
  guardarComprobante,
  registrarPago,
  subirComprobante,
  type Periodicidad,
} from "@/lib/admin/subscriptions";

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

export type AccionState = {
  error: string | null;
  ok: boolean;
  // La accion SI se hizo, pero el comprobante no se pudo adjuntar. Es un
  // estado real y merece su propia palabra: decir `error` seria mentir —la
  // demo ya esta dada— y callarlo dejaria a alguien creyendo que el recibo
  // quedo guardado.
  aviso?: string | null;
};

// Sube el comprobante y lo pega a su asiento. Devuelve el aviso si algo falla,
// null si fue bien o si no habia nada que adjuntar.
//
// SE HACE DESPUES, nunca antes. Subir primero y que luego falle la accion deja
// un archivo huerfano en el bucket que ya no respalda nada; al reves, lo peor
// que queda es un asiento sin foto, que se ve y se puede arreglar a mano.
async function adjunta(
  ownerId: string,
  eventoId: string | null,
  formData: FormData,
): Promise<string | null> {
  const archivo = formData.get("comprobante");
  if (!(archivo instanceof File) || archivo.size === 0) return null;

  if (!eventoId) {
    return "Se guardo, pero no supimos a que asiento pegar el comprobante.";
  }

  const { path, error } = await subirComprobante(ownerId, archivo);
  if (error || !path) {
    return `Se guardo, pero el comprobante no subio: ${error ?? "error desconocido"}`;
  }

  const { error: errorAdjunto } = await guardarComprobante(eventoId, path);
  if (errorAdjunto) {
    // El archivo ya no le sirve a nadie: no hay asiento que lo nombre, asi que
    // nadie lo va a encontrar nunca. Se borra en vez de dejarlo ocupando sitio.
    await borrarComprobante(path);
    return `Se guardo, pero no pudimos adjuntar el comprobante: ${errorAdjunto}`;
  }

  return null;
}

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

  const { error, eventoId } = await darDemo(ownerId, dias, email, notas, precio, periodicidad);
  if (error) return { error, ok: false };

  const aviso = await adjunta(ownerId, eventoId, formData);

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true, aviso };
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

  const { error, eventoId } = await cambiarPlan(ownerId, plan, email, periodicidad, precio, notas);
  if (error) return { error, ok: false };

  const aviso = await adjunta(ownerId, eventoId, formData);

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true, aviso };
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

  const { error, eventoId } = await registrarPago(ownerId, monto, metodo, hastaIso, email, notas);
  if (error) return { error, ok: false };

  const aviso = await adjunta(ownerId, eventoId, formData);

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true, aviso };
}

export async function accionBloquear(
  _prev: AccionState,
  formData: FormData,
): Promise<AccionState> {
  const { email } = await requireSuperadmin();

  const ownerId = String(formData.get("owner_id") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!ownerId) return { error: "Falta el negocio.", ok: false };
  // Se exige aquí y otra vez en la función de Postgres. No es redundante: esta
  // acción es un endpoint POST que se puede llamar sin pasar por el formulario.
  if (motivo.length < 3) {
    return { error: "Escribe por qué lo bloqueas. Queda en el historial.", ok: false };
  }

  const { error, eventoId } = await bloquear(ownerId, motivo, email);
  if (error) return { error, ok: false };

  const aviso = await adjunta(ownerId, eventoId, formData);

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true, aviso };
}

export async function accionDesbloquear(
  _prev: AccionState,
  formData: FormData,
): Promise<AccionState> {
  const { email } = await requireSuperadmin();

  const ownerId = String(formData.get("owner_id") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim() || null;
  if (!ownerId) return { error: "Falta el negocio.", ok: false };

  const { error } = await desbloquear(ownerId, email, motivo);
  if (error) return { error, ok: false };

  revalidatePath("/admin/cuentas");
  return { error: null, ok: true };
}
