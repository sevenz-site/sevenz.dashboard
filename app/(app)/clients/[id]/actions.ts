"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { DOCUMENT_SOURCE } from "@/lib/types";
import { mensajeDeError } from "@/lib/errores-legibles";
import { normalizeDocumentId } from "@/lib/format";

// TODAS LAS ACCIONES DE ESTE ARCHIVO ESCRIBEN EN `clients`, y la politica de
// la 061 se las rechaza a una cuenta pausada. Por eso cada una empieza
// preguntando si puede escribir, justo despues de comprobar la sesion.
//
// No sobra con dejar que la politica haga su trabajo: un update rechazado no
// devuelve error, afecta a cero filas. Marcar una mala paga o mandar un
// cliente a la papelera se veria como que funciono, y no habria pasado nada.

// CT-28. El choque de cedula deja de ser un callejon: `updateClient` devuelve
// QUIENES llevan ya esa cedula —con su saldo— para que el dialogo lo enseñe y
// el dueño pueda decir "si, es otra cuenta de la misma persona".
//
// A LISTA, no a uno. El mensaje viejo nombraba al primero que encontraba y
// callaba los demas: con las dos "Karina castillo" de produccion compartiendo
// la 18356808, decia una y la otra era invisible. Mismo fallo que CT-29b
// arreglo en la importacion.
export type ClienteQueChoca = {
  id: string;
  name: string;
  document_id: string | null;
  whatsapp: string | null;
  balance: number;
  balance_usd: number;
  balance_eur: number;
  // Fuera de la cartera: el aviso tiene que decirlo o el dueño va a Clientes a
  // buscar a alguien que no esta ahi. Al crear si se dice; al editar, no se
  // decia.
  hidden: "papelera" | "definitivo" | null;
};

export type EditClientState = {
  error: string | null;
  success: boolean;
  // Solo viene cuando la cedula nueva choca y nadie lo ha confirmado todavia.
  duplicados?: ClienteQueChoca[];
};

export async function updateClient(
  _prevState: EditClientState,
  formData: FormData,
): Promise<EditClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA, success: false };

  const clientId = String(formData.get("client_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  // SOLO DIGITOS, por lo mismo que en el alta: el filtro del navegador no es
  // una defensa del servidor. Ver la migracion 079.
  //
  // Y tiene un efecto util aqui: si una ficha vieja guarda "V-123", al
  // editarla `documentChanged` sale true contra el "123" filtrado, asi que
  // la comprobacion de duplicados corre y la ficha queda normalizada sola.
  const documentId = String(formData.get("document_id") ?? "").replace(/[^0-9]/g, "");
  const address = String(formData.get("address") ?? "").trim();

  if (!clientId) return { error: "Cliente inválido.", success: false };
  if (!name) return { error: "El nombre no puede quedar vacío.", success: false };
  // El documento sigue siendo obligatorio en todas las altas, así que editar
  // no puede ser la puerta de atrás para vaciarlo.
  //
  // EL WHATSAPP YA NO. Desde el 2026-09-21 es opcional al dar de alta y al
  // importar, y esta comprobación se quedó atrás: el diálogo decía
  // "WhatsApp (opcional)" mientras el servidor rechazaba guardar sin él, así
  // que un cliente importado sin número no se podía ni editar la dirección.
  // Guardar vacío escribe null, que es lo que la columna admite y lo que el
  // resto del app ya sabe manejar (ver pedir-whatsapp-dialog.tsx).
  if (!documentId) return { error: "Escribe la cédula del cliente.", success: false };

  // THE ORIGIN IS ONLY TOUCHED WHEN THE DOCUMENT ACTUALLY CHANGES.
  //
  // This update rewrites `document_id` on every save, changed or not. Setting
  // the origin here without looking would downgrade to 'owner' a document the
  // client declared themselves, just because the shopkeeper edited the address
  // — silently, erasing the very thing the column exists to hold.
  //
  // It is the same failure the document_country comment warns about three lines
  // below. This file already learned it once.
  const { data: previous } = await supabase
    .from("clients")
    .select("document_id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();

  // Compared as text, which is enough now that the field only accepts digits:
  // a record comes back from the form exactly as it went in unless someone
  // retyped it. Marking the origin unconditionally would downgrade to 'owner' a
  // document the client declared themselves, just because the shopkeeper edited
  // the address — silently erasing the very thing the column exists to hold.
  const documentChanged = (previous?.document_id ?? "").trim() !== documentId;

  // NADIE PUEDE EDITAR A UN CLIENTE HASTA DARLE LA CEDULA DE OTRO (CT-28).
  //
  // Esta comprobacion existia al CREAR (`createClientWithMovement`) y al
  // IMPORTAR (`confirmImport`), y aqui no existia en absoluto: editar a Carmen
  // y ponerle la cedula de Petra se guardaba sin una palabra, con su toast de
  // "Cliente actualizado". Visto en dev el 2026-10-01 al intentar provocar el
  // error de clave repetida para comprobar otra cosa.
  //
  // Y no es cosmetico. `confirmImport` monta un Map de clientes POR CEDULA
  // NORMALIZADA (`clientsByNormalizedDocumentId`) para decidir a quien
  // pertenece cada renglon de una libreta: con dos fichas compartiendo cedula,
  // una gana y la otra no, en silencio, y un fiado puede acabar en la persona
  // equivocada. El agujero estaba en una pantalla de contacto y salia por el
  // camino del dinero.
  //
  // Se compara NORMALIZADA —sin puntos ni mayusculas— porque el documento se
  // guarda tal como se teclea: "V-19.887.766" y "19887766" son el mismo.
  // Se incluyen los ocultos y los de la papelera por lo mismo que al crear:
  // dejarlos fuera permitiria duplicar a alguien que solo esta escondido.
  //
  // BLOQUEA, no pregunta. Al crear se puede confirmar que es otra cuenta a
  // proposito —el caso "Pepito" y "Pepito negocio"—, y ese camino sigue
  // abierto; lo que no tiene sentido es llegar a esa situacion EDITANDO a
  // alguien que ya existe. Si hace falta, se anade aqui la misma confirmacion.
  //
  // SOLO SI LA CEDULA CAMBIA, y esto no es un detalle: el duplicado deliberado
  // EXISTE y esta en produccion. Medido el 2026-10-01 — "Karina castillo
  // (negocio lomas)" y "Karina castillo (kari)" comparten la 18356808 a
  // proposito, que es exactamente el caso para el que la migracion 034 tiro el
  // indice unico. Comprobando en cada guardado, su duenia no podria volver a
  // tocarles NI LA DIRECCION: le saldria "esa cedula ya es de Karina castillo
  // (kari)" al editar a Karina castillo. Un cliente que ya convive con su
  // duplicado se queda como esta; lo que se impide es CREAR la colision desde
  // aqui.
  if (documentId && documentChanged) {
    const normalizado = normalizeDocumentId(documentId);
    const { data: suyos } = await supabase
      .from("clients")
      .select("id, name, document_id, whatsapp")
      .eq("owner_id", user.id)
      .neq("id", clientId)
      .not("document_id", "is", null);
    const chocan = (suyos ?? []).filter(
      (c) => c.document_id && normalizeDocumentId(c.document_id as string) === normalizado,
    );
    // CT-28: DEJA DE SER UN MURO Y PASA A SER UNA PREGUNTA.
    //
    // Hasta el 2026-10-02 esto bloqueaba sin salida, y era el UNICO de los tres
    // sitios donde se teclea una cedula que lo hacia: el alta ofrece "Crear
    // cuenta separada" desde la 034, y la importacion lo ofrece desde CT-29b.
    // Que la misma situacion se resolviera de dos formas segun la pantalla por
    // la que entras no habia manera de explicarlo.
    //
    // El caso que rompia, medido: una ficha creada deprisa sin cedula —"Karina
    // negocio"— a la que tres semanas despues se le quiere poner la de Karina.
    // No se podia, y la unica salida que le queda a quien no sabe de codigo es
    // borrar la ficha y rehacerla, perdiendo los movimientos. O sea, deudas.
    const confirmado = String(formData.get("confirm_duplicate") ?? "") === "true";
    if (chocan.length > 0 && !confirmado) {
      // El saldo sale en consulta aparte y solo en este camino: es lo que
      // convierte la confirmacion en una decision informada en vez de un boton
      // que se pulsa sin leer. Nadie dice "es otra cuenta de la misma persona"
      // viendo que la otra debe $3.016 y no la reconoce.
      const ids = chocan.map((c) => c.id as string);
      const { data: saldos } = await supabase
        .from("client_summary_all")
        .select("client_id, balance, balance_usd, balance_eur, trashed_at, deleted_at")
        .eq("owner_id", user.id)
        .in("client_id", ids);
      const porId = new Map((saldos ?? []).map((s) => [s.client_id as string, s]));
      return {
        error: null,
        success: false,
        duplicados: chocan.map((c) => {
          const s = porId.get(c.id as string);
          return {
            id: c.id as string,
            name: c.name as string,
            document_id: c.document_id as string | null,
            whatsapp: (c as { whatsapp?: string | null }).whatsapp ?? null,
            balance: (s?.balance as number | null) ?? 0,
            balance_usd: (s?.balance_usd as number | null) ?? 0,
            balance_eur: (s?.balance_eur as number | null) ?? 0,
            hidden: s?.deleted_at ? "definitivo" : s?.trashed_at ? "papelera" : null,
          };
        }),
      };
    }
  }

  // document_country is deliberately absent from this update: it's inherited
  // from the owner at creation and no longer editable in the UI, so listing
  // it here would wipe the stored value to null on every save.
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      // `null`, nunca `""`: la cadena vacía se colaría como "sí hay número"
      // en el `.is("whatsapp", null)` con el que la importación decide si
      // rellenar el hueco, y ese cliente nunca volvería a recibir uno.
      whatsapp: whatsapp || null,
      document_id: documentId,
      ...(documentChanged ? { document_source: DOCUMENT_SOURCE.OWNER } : {}),
      address: address || null,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);

  if (error) {
    return { error: mensajeDeError("guardar los cambios", error, "updateClient"), success: false };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

export type FlagClientState = { error: string | null; success: boolean };

// Marks a client "Mala paga" — always requires a reason, logged in
// client_flags so the history survives even after the client is unflagged.
export async function flagClient(
  _prevState: FlagClientState,
  formData: FormData,
): Promise<FlagClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA, success: false };

  const clientId = String(formData.get("client_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!clientId) return { error: "Cliente inválido.", success: false };
  if (!reason) return { error: "Escribe un motivo.", success: false };

  const { error: flagError } = await supabase.from("client_flags").insert({
    client_id: clientId,
    owner_id: user.id,
    reason,
  });
  if (flagError) {
    return { error: mensajeDeError("registrar la marca", flagError, "flagClient"), success: false };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ is_flagged: true })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: mensajeDeError("marcar al cliente", updateError, "flagClient"), success: false };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

// Reverses flagClient — no reason needed, immediate, same "restore" precedent
// as restoreMovement. The closed client_flags row stays as history.
export async function unflagClient(clientId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };

  const { error: closeError } = await supabase
    .from("client_flags")
    .update({ unflagged_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("owner_id", user.id)
    .is("unflagged_at", null);
  if (closeError) {
    return { error: mensajeDeError("quitar la marca", closeError, "unflagClient") };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ is_flagged: false })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: mensajeDeError("quitar la marca", updateError, "unflagClient") };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null };
}

// ── Papelera ────────────────────────────────────────────────────────────
// Two hiding states, both reversible in the database and neither one a
// delete: the row, its movements, its flags and its share link all survive.
// See PAPELERA-PLAN.md — the wording is "Mover a papelera" and "Ocultar
// definitivamente", never "Eliminar", because an owner who clicks Eliminar and
// later finds their "deleted" client still viewing a live balance has been
// misled by the button.

export type HideClientState = { error: string | null };

// Every screen that can show or count a client. Trashing changes what all of
// them display, and Next caches each one independently.
function revalidateClientSurfaces(clientId: string) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/malas-pagas");
  revalidatePath("/papelera");
  revalidatePath("/notificaciones");
}

export async function trashClient(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
  if (!clientId) return { error: "Cliente inválido." };

  // Ownership checked explicitly rather than left to RLS, per CLAUDE.md —
  // clientId arrives from the browser. Reading trashed_at in the same query
  // also makes a double-submit a no-op instead of a second snapshot.
  const { data: client } = await supabase
    .from("clients")
    .select("id, trashed_at")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };
  if (client.trashed_at) return { error: null };

  // The balance is snapshotted here, not derived later: once the client is
  // hidden, "Capital por cobrar" drops by this amount, and this row is the
  // only thing that can later explain the drop. Read from client_summary_all
  // because client_summary is about to stop returning this client — though at
  // this instant it still would, the unfiltered view is the honest source and
  // survives a retry after a partial failure.
  const { data: summary } = await supabase
    .from("client_summary_all")
    .select("balance, balance_usd, balance_eur")
    .eq("client_id", clientId)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      trashed_at: new Date().toISOString(),
      trashed_balance: summary?.balance ?? 0,
      trashed_balance_usd: summary?.balance_usd ?? 0,
      trashed_balance_eur: summary?.balance_eur ?? 0,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (updateError) {
    return { error: mensajeDeError("mover el cliente a la papelera", updateError, "trashClient") };
  }

  // The notification is the undo path, the same way movement_deletions is for
  // a deleted movement. A failure to write it leaves the client correctly
  // trashed with no way back from the notifications screen — recoverable from
  // the Papelera itself, so it is logged rather than surfaced as an error the
  // owner cannot act on.
  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "trashed",
  });
  if (hideError) console.error("trashClient: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}

export async function restoreClient(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
  if (!clientId) return { error: "Cliente inválido." };

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };

  // Clears both states at once, so restoring works from the Papelera and from
  // a permanently hidden client alike. is_flagged is deliberately untouched:
  // a client who was mala paga when they were trashed comes back mala paga.
  // The snapshot is cleared because it now has nothing to explain — the
  // balance is back in the totals it left.
  const { error } = await supabase
    .from("clients")
    .update({
      trashed_at: null,
      deleted_at: null,
      trashed_balance: null,
      trashed_balance_usd: null,
      trashed_balance_eur: null,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (error) {
    return { error: mensajeDeError("restaurar el cliente", error, "restoreClient") };
  }

  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "restored",
  });
  if (hideError) console.error("restoreClient: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}

export async function hideClientPermanently(clientId: string): Promise<HideClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
  if (!clientId) return { error: "Cliente inválido." };

  const { data: client } = await supabase
    .from("clients")
    .select("id, trashed_at, deleted_at")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!client) return { error: "Cliente inválido." };
  if (client.deleted_at) return { error: null };
  // Reachable only from the Papelera, so the owner has already seen this
  // client once in a list titled "Papelera" before hiding them for good. A
  // one-step path from a client's own screen straight to the state nobody can
  // undo is exactly the button people click by accident.
  if (!client.trashed_at) {
    return { error: "Primero mueve el cliente a la papelera." };
  }

  // trashed_at is left in place. It is when the client left the totals, which
  // is the date a report needs; deleted_at only records when they stopped
  // being listed in the Papelera.
  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("owner_id", user.id);
  if (error) {
    return { error: mensajeDeError("ocultar el cliente", error, "hideClient") };
  }

  const { error: hideError } = await supabase.from("client_hides").insert({
    client_id: clientId,
    owner_id: user.id,
    action: "hidden",
  });
  if (hideError) console.error("hideClientPermanently: client_hides insert failed", hideError);

  revalidateClientSurfaces(clientId);
  return { error: null };
}

// Guarda la ruta de la foto que el navegador acaba de subir al bucket.
//
// La subida en sí la hace el navegador con la sesión del dueño, igual que las
// fotos de un movimiento: la política de la 052 solo le deja escribir dentro de
// una carpeta que se llama como su propio id. Esta accion no toca el archivo,
// solo apunta el cliente hacia él.
//
// El `.eq("owner_id", user.id)` no sobra por tener RLS detras: clientId llega
// del navegador, y comprobar a quién pertenece antes de escribir es la regla
// que este proyecto ya se saltó dos veces. Si el cliente no es suyo, la
// actualización no encuentra fila y no pasa nada.
export async function setClientProfilePicture(
  clientId: string,
  path: string | null,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id)))
    return { error: MENSAJE_CUENTA_PAUSADA };
  if (!clientId) return { error: "Cliente inválido." };

  // Una ruta que no empiece por la carpeta del dueño se rechaza aquí también, y
  // no solo en Storage: sin esto, alguien podría apuntar a un cliente suyo
  // hacia la foto de un cliente ajeno — el bucket es público, así que bastaría
  // con saber la ruta. La política de Storage gobierna quién ESCRIBE archivos;
  // esta comprobación gobierna a cuál se puede APUNTAR.
  if (path && !path.startsWith(`${user.id}/`)) {
    return { error: "No pudimos guardar la foto." };
  }

  // La ruta que había antes, para poder borrar ese archivo después. Se lee con
  // el mismo filtro de dueño, así que si el cliente no es suyo no hay fila y no
  // se toca nada.
  const { data: actual } = await supabase
    .from("clients")
    .select("profile_picture_path")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!actual) return { error: "Cliente inválido." };

  const { error } = await supabase
    .from("clients")
    .update({ profile_picture_path: path })
    .eq("id", clientId)
    .eq("owner_id", user.id);

  if (error) return { error: mensajeDeError("guardar la foto", error, "clientPhoto") };

  // El archivo viejo se borra de verdad, y después de actualizar la fila, no
  // antes: si el borrado falla queda un archivo huérfano ocupando espacio, que
  // es molesto; al revés quedaría un cliente apuntando a una foto que ya no
  // existe, que es un círculo roto en pantalla.
  //
  // Dos motivos para borrarlo y no solo desvincularlo. El espacio se paga y
  // cada foto nueva dejaba la anterior guardada para siempre. Y el bucket es
  // público: una foto "borrada" que sigue en su sitio sigue abierta a cualquiera
  // que conozca el enlace, que es lo contrario de lo que el dueño acaba de
  // pedir. El borrado va con la sesión del dueño, así que la política de la 052
  // lo limita a su propia carpeta.
  const anterior = actual.profile_picture_path as string | null;
  if (anterior && anterior !== path) {
    const { error: borrado } = await supabase.storage
      .from("client-profile-pictures")
      .remove([anterior]);
    // No se le devuelve al dueño: para él la acción salió bien —su cliente ya
    // tiene la foto que quería, o ninguna—. Un archivo que sobra es cosa
    // nuestra, no suya.
    if (borrado) console.error("[foto-cliente] no pudimos borrar la anterior:", borrado.message);
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null };
}
