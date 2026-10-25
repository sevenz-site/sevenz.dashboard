"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { mensajeDeError } from "@/lib/errores-legibles";
// ═══════════════════════════════════════════════════════════════════════
// AQUÍ VIVÍAN `createClientWithMovement` Y `addMovement`, Y SE BORRARON
// EL 2026-10-24 POR ORDEN DEL DUEÑO
//
// Eran las dos acciones del diálogo «Agregar transacción»: la primera daba de
// alta un cliente con su primer movimiento, la segunda añadía un movimiento a
// uno que ya existía. Ninguna de las dos tenía ya pantalla que las llamara.
//
// QUÉ LAS SUSTITUYE, que es lo que hay que saber para no reescribirlas:
//
//   · Un cliente nuevo  → `/clients/nuevo` y `crearCliente`, desde el
//                          2026-10-18. Da de alta SIN movimiento; la venta
//                          viene después, si viene.
//   · Un fiado o venta  → `/ventas/nueva` y `registrarVenta`, el asistente de
//                          cuatro pasos. Un fiado es una venta sin pago desde
//                          la migración `124`.
//   · Un abono          → `/abonos/nuevo` y `registrarAbonoRepartido`, que
//                          empieza por elegir QUÉ fiado se paga. Un abono
//                          dirigido no se puede expresar con el monto suelto
//                          que estas dos escribían.
//
// POR QUÉ NO BASTABA CON DEJARLAS: las tres acciones nuevas guardan cosas que
// estas no — el fiado al que apunta un abono, las líneas de producto de una
// venta, los bolívares tecleados por línea de un reparto. Una puerta vieja que
// escribe movimientos sin nada de eso no es una alternativa más: es una forma
// de meter en la base filas que el resto de la app ya no sabe explicar.


export async function getOrCreateShareLink(clientId: string): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };

  const { data: existing } = await supabase
    .from("share_links")
    .select("token")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing) return { token: existing.token };

  const { data: created, error } = await supabase
    .from("share_links")
    .insert({ client_id: clientId })
    .select("token")
    .single();

  if (error || !created) return { error: "No pudimos generar el link." };

  return { token: created.token };
}

// Soft-deletes a movement the owner registered by mistake. The row stays in
// place (deleted_at set) so it can be restored later from a notification;
// every movement after it gets its running_balance rewritten to match.
//
// ===========================================================================
// `conAbonos`: QUÉ PASA CON LO QUE YA SE LE ABONÓ A ESTE FIADO
//
// Encargo del dueño el 2026-10-23: *«al eliminar el fiado pregunta en la modal
// de confirmación si quiere eliminar también el abono o solo el fiado»*.
//
// POR QUÉ HACÍA FALTA PREGUNTAR Y NO DECIDIRLO AQUÍ: las dos respuestas son
// correctas y describen dos cosas distintas que pasan en un mostrador.
//
//   * «Me equivoqué al anotar el fiado» — el fiado no existió, pero el
//     cliente SÍ le dio ese dinero. El abono se queda y sigue descontando del
//     saldo. Es el valor por defecto porque es el caso que no pierde dinero
//     de nadie.
//   * «Esto nunca pasó» — se anuló la venta entera. Entonces el abono tampoco
//     existió y se va con el fiado.
//
// Borrar siempre los abonos le quitaría al cliente un pago que hizo de verdad.
// No borrarlos nunca deja un abono suelto descontando de un saldo que ya no
// tiene a qué aplicarse. Por eso lo decide quien estaba en el mostrador.
//
// SOLO LOS DIRIGIDOS A ESTE FIADO (`applies_to_movement_id`). Un abono que la
// cola FIFO repartió sobre el saldo total no es «de» este fiado y no se toca:
// no hay forma de saber qué parte le correspondía.
//
// LOS DOS SE PUEDEN RESTAURAR: cada fila borrada entra en `movement_deletions`
// por separado, así que en Notificaciones salen como dos avisos. Restaurar el
// fiado NO devuelve sus abonos solo, y eso es a propósito: devolverlos juntos
// exigiría recordar que se borraron juntos, que es un dato que esta tabla no
// guarda. Dos avisos dicen la verdad; uno que restaura dos cosas, no.
export async function deleteMovement(
  movementId: string,
  opciones?: { conAbonos?: boolean },
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // Borrar un movimiento es un update — el borrado es blando — y un update
  // que la política rechaza no da error: afecta a cero filas y se vería como
  // un borrado que funcionó. Por eso se pregunta antes.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { error: MENSAJE_CUENTA_PAUSADA };
  }

  // THE OWNERSHIP CHECK, EXPLICIT AND NOT JUST RLS. `movementId` arrives from
  // the browser and `movements` carries no `owner_id`, so the check goes
  // through the client, exactly as `app/(app)/clients/[id]/actions.ts` does it.
  //
  // Added 2026-10-16, while verifying that a deletion reaches Notificaciones.
  // It was not exploitable -- RLS held -- but it was the single point of
  // failure CLAUDE.md's rule exists for, in the one action that erases money.
  // The 2026-08-28 audit found the same shape in `getOrCreateShareLink` and
  // `confirmImport` and fixed both; this one was missed.
  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id, clients!inner(owner_id)")
    .eq("id", movementId)
    .eq("clients.owner_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos esa transacción." };
  }

  const borradoEn = new Date().toISOString();

  // LOS ABONOS PRIMERO, y el fiado después. Si el borrado de los abonos falla,
  // el fiado sigue vivo y la pantalla no ha cambiado: el tendero vuelve a
  // intentarlo. Al revés —fiado primero— un fallo dejaría exactamente lo que
  // este encargo existe para evitar: un abono apuntando a un fiado que ya no
  // está, que es el 404 que el dueño reportó el 2026-10-23.
  //
  // `.eq("client_id", movement.client_id)` NO SOBRA aunque ya sepamos de quién
  // es el fiado: `applies_to_movement_id` es una FK suelta a `movements (id)`
  // y nada obliga a que apunte dentro del mismo cliente. Es la misma cautela
  // que ya lleva la consulta de abonos de `transacciones/[movementId]`.
  let abonosBorrados: string[] = [];
  if (opciones?.conAbonos) {
    const { data: abonos, error: abonosError } = await supabase
      .from("movements")
      .update({ deleted_at: borradoEn })
      .eq("applies_to_movement_id", movementId)
      .eq("client_id", movement.client_id)
      .eq("type", "payment")
      .is("deleted_at", null)
      .select("id");
    if (abonosError) {
      return { error: mensajeDeError("eliminar los abonos", abonosError, "deleteMovement") };
    }
    abonosBorrados = (abonos ?? []).map((a) => a.id as string);
  }

  const { error: deleteError } = await supabase
    .from("movements")
    .update({ deleted_at: borradoEn })
    .eq("id", movementId);

  if (deleteError) {
    return { error: mensajeDeError("eliminar la transacción", deleteError, "deleteMovement") };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: mensajeDeError("recalcular el saldo", recalcError, "recalc") };
  }

  // UNA FILA POR MOVIMIENTO BORRADO. Ver la cabecera: dos avisos separados en
  // Notificaciones, porque restaurar los dos juntos exigiría guardar que se
  // borraron juntos y esta tabla no lo guarda.
  const { error: notifyError } = await supabase.from("movement_deletions").insert(
    [movementId, ...abonosBorrados].map((id) => ({
      movement_id: id,
      owner_id: user.id,
      client_id: movement.client_id,
    })),
  );
  if (notifyError) {
    console.error("deleteMovement: failed to record notification", notifyError);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${movement.client_id}`);
  return { error: null };
}

// Restores a movement previously deleted via deleteMovement, recalculating
// balances the same way. Triggered from the "movimiento eliminado" notification.
export async function restoreMovement(movementId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // Borrar un movimiento es un update — el borrado es blando — y un update
  // que la política rechaza no da error: afecta a cero filas y se vería como
  // un borrado que funcionó. Por eso se pregunta antes.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { error: MENSAJE_CUENTA_PAUSADA };
  }

  // Same explicit ownership check as `deleteMovement` above, and for the same
  // reason: restoring puts an amount back into somebody's balance, so it moves
  // money exactly as deleting does.
  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id, sale_id, clients!inner(owner_id)")
    .eq("id", movementId)
    .eq("clients.owner_id", user.id)
    .not("deleted_at", "is", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos esa transacción eliminada." };
  }

  // LA VENTA DE LA QUE NACIÓ VUELVE CON ÉL, si también estaba borrada.
  //
  // Desde el 2026-10-20 hay una forma de borrar una venta entera
  // (`eliminarVenta`), y borra la venta Y sus fiados. Sin esta línea, restaurar
  // el fiado desde su notificación lo devolvería al saldo mientras su venta
  // sigue borrada: el movimiento existiría sin los productos que lo explican, y
  // su parte de contado seguiría sin aparecer. Un restaurado a medias es peor
  // que no poder restaurar, porque nadie se entera de que falta la mitad.
  if (movement.sale_id) {
    const { error: errorVenta } = await supabase
      .from("sales")
      .update({ deleted_at: null })
      .eq("id", movement.sale_id)
      .eq("owner_id", user.id)
      .not("deleted_at", "is", null);
    if (errorVenta) console.error("restoreMovement: no se pudo revivir la venta", errorVenta.message);
  }

  const { error: restoreError } = await supabase
    .from("movements")
    .update({ deleted_at: null })
    .eq("id", movementId);

  if (restoreError) {
    return { error: mensajeDeError("restaurar la transacción", restoreError, "restoreMovement") };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: mensajeDeError("recalcular el saldo", recalcError, "recalc") };
  }

  await supabase
    .from("movement_deletions")
    .update({ restored_at: new Date().toISOString() })
    .eq("movement_id", movementId)
    .is("restored_at", null);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${movement.client_id}`);
  return { error: null };
}

// Guardar el WhatsApp de un cliente que no tenía, desde donde haga falta.
//
// Nació para el diálogo de "Compartir saldo vía WhatsApp": al hacerse opcional
// el número, compartir con un cliente que no lo tiene abre un campo ahí mismo
// en vez de mandar al dueño a "Editar cliente" y perder lo que estaba
// haciendo. Es el momento en que el dato de verdad le sirve, que es justo
// cuando vale la pena pedirlo.
//
// COMPROBACIÓN DE PROPIEDAD EXPLÍCITA, no solo RLS: `clientId` viene del
// navegador. Es la regla de CLAUDE.md, escrita después de encontrar dos
// funciones que se apoyaban solo en las políticas.
export async function guardarWhatsappDeCliente(
  clientId: string,
  whatsapp: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const numero = whatsapp.trim();
  if (!numero) return { error: "Escribe el número de WhatsApp." };

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };

  const { error } = await supabase
    .from("clients")
    .update({ whatsapp: numero })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (error) return { error: "No pudimos guardar el número. Intenta de nuevo." };

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
