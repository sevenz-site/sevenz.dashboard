"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeDocumentId } from "@/lib/format";
import { resolveMovementRateSnapshot, type MovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { trackServer } from "@/lib/mixpanel-server";
import { recordMovementRejection } from "@/lib/movement-rejection";
import type { LedgerCurrency, MovementType } from "@/lib/types";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
// DOCUMENT_SOURCE ya no se importa aquí: quien escribe `document_source` es
// ahora `import_libreta()` (migración 073), que pone 'owner' porque la cédula
// la tecleó el dueño en la revisión y no salió de la foto. La restricción que
// admite solo 'owner' y 'client' está en la 063.

export type ImportRow = {
  client_id: string | null;
  client_name: string;
  type: MovementType;
  amount: number;
  description: string | null;
  // Required unless client_id already points to a client who has one on
  // file — see the "needs_document_id" review-table logic that decides
  // when the owner actually had to type this in.
  document_id: string | null;
  // Opcional siempre. Solo se escribe cuando viene con algo y el cliente no
  // tenía número: nunca pisa uno ya guardado, porque el de la libreta puede
  // ser más viejo que el que el dueño corrigió a mano en la ficha.
  whatsapp: string | null;
  // Chosen by the owner per row in the review table, because one libreta can
  // mix currencies.
  //
  // null significa dos cosas distintas según el país, y por eso no se puede
  // tratar igual: en un negocio CO es la respuesta correcta — su libro no tiene
  // dimensión de moneda —, y en uno VE es un dato que falta.
  //
  // Esto ya NO se rellena solo. Hasta 2026-09-11, un null de un dueño VE se
  // convertía en USD por defecto: una apuesta sobre el dinero de alguien, hecha
  // donde nadie la veía. Ahora resolveMovementRateSnapshot rechaza, y la tanda
  // entera se detiene sin escribir ni una fila.
  currency: LedgerCurrency | null;
  // La nota interna del dueño sobre esta línea. Hoy la escribe una sola cosa:
  // importar una página cuya suma no cuadraba con el total escrito a mano.
  //
  // NUNCA se mete en `description`. `description` es lo único de un movimiento
  // que el cliente lee en `/s/[token]`, y esto es una nota del dueño sobre sus
  // dudas con las cuentas de esa persona. Columna aparte desde la 074, y
  // `get_shared_balance` enumera sus campos uno a uno, así que no se filtra
  // sola.
  owner_note?: string | null;
  // La fecha que la IA leyó en la libreta, ya corregida por el dueño si hizo
  // falta, en ISO. Null cuando la página no traía fecha en ese renglón: entonces
  // el movimiento se guarda con la de la subida.
  //
  // NO ES UN CAMPO MÁS. `created_at` decide el saldo corrido y la mora — ver la
  // cabecera de la migración 076 —, y por eso la función descarta una fecha
  // futura o anterior a 2015 en vez de fiarse de lo que llegue de aquí.
  created_at?: string | null;
  // CT-29b. "Ya se que esa cedula es de alguien; abrele otra cuenta igual."
  //
  // La 034 tiro el indice unico justamente para permitirlo: una persona puede
  // llevar dos libros a proposito —el personal y el del negocio— bajo la misma
  // cedula. Hasta hoy esta ruta lo rechazaba, asi que la importacion era mas
  // estricta que el alta manual, que ya ofrece "Crear cuenta separada" desde
  // `confirm_duplicate` en `app/(app)/dashboard/actions.ts`.
  //
  // NO vale para un cliente en la papelera, ni con esto en true: ahi el
  // segundo registro partiria el historial de alguien que sigue existiendo, y
  // lo correcto es restaurarlo. Esa puerta se queda cerrada.
  confirm_duplicate?: boolean;
  // CT-33. "Si, se que esta en la papelera (o que lo oculte); restauralo al
  // subir esto."
  //
  // Lo manda la revision cuando el dueño emparejo con un cliente oculto
  // HABIENDO VISTO su marca y la cifra que vuelve a sus totales. Nunca se
  // deduce en el servidor: restaurar devuelve un saldo a "Capital por cobrar",
  // y eso no puede pasar porque un payload viejo apuntara a alguien que entre
  // tanto se oculto.
  confirm_restore?: boolean;
};

export type ConfirmImportState = { error: string | null; imported: number };

export async function confirmImport(rows: ImportRow[]): Promise<ConfirmImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", imported: 0 };

  // Una importacion son decenas de inserts en `clients` y `movements`. Con la
  // cuenta pausada la politica los rechaza uno a uno, asi que el tendero
  // acabaria con un resumen de cuarenta lineas en rojo. Se para entera y antes.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { error: MENSAJE_CUENTA_PAUSADA, imported: 0 };
  }
  if (rows.length === 0) return { error: "No hay movimientos para subir.", imported: 0 };

  // Resolved once per distinct currency in the batch, not once per row.
  //
  // getOwnerRateContext underneath makes three database round trips and can
  // trigger a BCV refresh, so calling it per row would multiply that by the
  // whole import. There are at most two distinct currencies (a VE owner's USD
  // and EUR) or one (a CO owner's null), so this is one or two calls either
  // way.
  //
  // This used to be a single call with a hardcoded null, which meant a VE
  // owner importing a libreta kept in euros got every row filed as USD —
  // their client's real debt, in the wrong ledger, with no currency shown
  // anywhere in the review screen to catch it.
  //
  // Y se resuelven TODAS antes de insertar la primera fila. Si alguna moneda de
  // la tanda no se puede resolver, la importación aborta aquí, con cero filas
  // escritas: media libreta importada es peor que ninguna, porque el dueño no
  // sabe por dónde iba y reimportar duplica lo que ya entró.
  const snapshots = new Map<string, MovementRateSnapshot>();
  for (const currency of new Set(rows.map((r) => r.currency ?? null))) {
    const resolucion = await resolveMovementRateSnapshot(supabase, user.id, currency);
    if (!resolucion.ok) {
      // rows.length y no 1: aquí se pierde la tanda entera, y ese es el número
      // que dice lo que costó. Sin él, un rechazo de import parece tan barato
      // como uno de un fiado suelto.
      await recordMovementRejection(supabase, {
        reason: resolucion.reason,
        source: "import",
        userId: user.id,
        userEmail: user.email,
        attemptedCurrency: currency,
        rowsAffected: rows.length,
      });
      return { error: resolucion.error, imported: 0 };
    }
    snapshots.set(currency ?? "COP", resolucion.snapshot);
  }

  // The import review table collects no per-client document country, so a
  // client created here inherits the owner's own — right for the vast
  // majority, and correctable afterward from "Editar cliente" for the
  // cross-border exceptions.
  const { data: ownerRow } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();
  const ownerCountry = (ownerRow?.country as string | undefined) ?? null;

  // client_id, when present, comes straight from the browser — verify each
  // one actually belongs to this owner before trusting it, rather than
  // relying only on the movements insert's RLS check to catch a mismatch.
  const providedClientIds = [...new Set(rows.map((r) => r.client_id).filter((id): id is string => Boolean(id)))];
  const ownedClientIds = new Set<string>();
  // Existing clients' current document_id, checked server-side rather than
  // trusting the review table's own needs_document_id flag — that flag is
  // just what decided whether to show/require the input client-side.
  const existingDocumentIds = new Map<string, string | null>();
  // A row can sit in the review table long enough for its client to be moved
  // to the Papelera in another tab. Confirming it then would write movements
  // onto a client no list shows and no total counts, which is the silent kind
  // of wrong — so the whole batch stops and names the client.
  const hiddenClientNames = new Map<string, string>();
  if (providedClientIds.length > 0) {
    const { data: ownedClients } = await supabase
      .from("clients")
      .select("id, name, document_id, trashed_at, deleted_at")
      .eq("owner_id", user.id)
      .in("id", providedClientIds);
    for (const c of ownedClients ?? []) {
      ownedClientIds.add(c.id as string);
      existingDocumentIds.set(c.id as string, c.document_id as string | null);
      if (c.trashed_at || c.deleted_at) hiddenClientNames.set(c.id as string, c.name as string);
    }
  }
  // ── CT-33: EMPAREJAR CON UN OCULTO LO RESTAURA, si el dueño lo confirmo ──
  //
  // Antes esto paraba la tanda y mandaba a Papelera: salir de la revision, ir
  // a otra pantalla, restaurar, volver. Y para un cliente "oculto
  // definitivamente" el mensaje era directamente falso — ese no sale ni en
  // Papelera, asi que mandaba a buscarlo a un sitio vacio.
  //
  // Ahora la revision lo enseña con su marca, el dialogo de confirmacion dice
  // que se va a restaurar y CON QUE SALDO vuelve a los totales, y aqui solo se
  // comprueba que esa confirmacion viajo. Sin ella sigue parando: restaurar
  // devuelve dinero a "Capital por cobrar" y eso no puede pasar por accidente.
  const restoreClientIds = new Set<string>();
  const sinConfirmar: string[] = [];
  for (const [id, nombre] of hiddenClientNames) {
    const confirmada = rows.some((r) => r.client_id === id && r.confirm_restore);
    if (confirmada) restoreClientIds.add(id);
    else sinConfirmar.push(nombre);
  }
  if (sinConfirmar.length > 0) {
    return {
      error: `${sinConfirmar.join(", ")} está fuera de tu cartera. Vuelve a abrir la revisión y dinos si quieres recuperarlo con esta libreta.`,
      imported: 0,
    };
  }

  // Nothing stops the same person being registered twice under one owner —
  // catch it here before creating a brand-new client, same as the manual
  // "Registrar cliente nuevo" flow. Seeded from every client this owner
  // already has on file, then grown as new clients get created below so
  // two different rows in the SAME batch can't collide with each other
  // either. There's no per-row picker in this batch flow, so a hit just
  // blocks the whole import with a clear message instead of silently
  // duplicating.
  //
  // Hidden clients are included here on purpose (decision O3): the import must
  // match them rather than quietly create a second record, which would split
  // one person's history across two clients with no way for the owner to merge
  // them back.
  const { data: allOwnerClients } = await supabase
    .from("clients")
    .select("id, name, document_id, trashed_at, deleted_at")
    .eq("owner_id", user.id)
    .not("document_id", "is", null);
  // A LISTA, NO A UNO (CT-29b). Guardaba un solo cliente por documento, asi
  // que con dos fichas de la misma cedula —el caso real de produccion que la
  // 034 permite— ganaba la ultima del bucle y la otra era invisible: el error
  // nombraba a una persona y callaba la otra, y el dueño no podia entender
  // contra que estaba chocando.
  const clientsByNormalizedDocumentId = new Map<
    string,
    { id: string; name: string; hidden: boolean; enLaTanda?: boolean }[]
  >();
  for (const c of allOwnerClients ?? []) {
    if (!c.document_id) continue;
    const key = normalizeDocumentId(c.document_id as string);
    const entry = {
      id: c.id as string,
      name: c.name as string,
      hidden: Boolean(c.trashed_at || c.deleted_at),
    };
    const ya = clientsByNormalizedDocumentId.get(key);
    if (ya) ya.push(entry);
    else clientsByNormalizedDocumentId.set(key, [entry]);
  }

  // ── De aquí abajo ya no se escribe: se ARMA ──────────────────────────
  //
  // Este bucle era el que insertaba fila a fila, y ante el primer fallo volvía
  // con las que ya habían entrado: `return { error, imported }`. Sin
  // transacción, la fila 27 de 30 dejaba 26 escritas, el dueño entendía «no se
  // importó», lo reintentaba, y 26 clientes acababan con sus fiados por
  // duplicado.
  //
  // Ahora recorre lo mismo y toma las mismas decisiones, pero en vez de
  // escribir construye el payload que `import_libreta()` (migración 073)
  // escribe de una sola vez. Por eso `imported` es 0 en TODOS los errores de
  // aquí: no se ha tocado nada, y decir otra cosa sería justo la mentira que
  // hacía peligroso reintentar.
  //
  // LAS COMPROBACIONES DE ABAJO SE QUEDAN AUNQUE LA FUNCIÓN LAS REPITA. Es
  // deliberado y es la regla de CLAUDE.md: la función es `SECURITY DEFINER`,
  // así que TIENE que validar por su cuenta —no puede fiarse de lo que le
  // llegue—, y aquí se validan otra vez para fallar antes del viaje y, sobre
  // todo, para poder decir el nombre del cliente en la frase. La función
  // devuelve un `code`; el castellano vive aquí.
  const clientsNew: {
    key: string;
    name: string;
    document_id: string;
    whatsapp: string | null;
    document_country: string | null;
    confirm_duplicate: boolean;
  }[] = [];
  const clientDocuments: { client_id: string; document_id: string }[] = [];
  const clientWhatsapps: { client_id: string; whatsapp: string }[] = [];
  const movements: Record<string, unknown>[] = [];

  // Una clave temporal por cliente nuevo. El movimiento no puede traer un uuid
  // que todavía no existe, así que trae esto y la función lo traduce.
  const keyByName = new Map<string, string>();

  for (const row of rows) {
    const cacheKey = row.client_name.trim().toLowerCase();
    const documentId = row.document_id?.trim() || null;
    let clientId: string | null = null;
    let clientKey: string | null = null;

    if (row.client_id) {
      if (!ownedClientIds.has(row.client_id)) {
        return { error: `Cliente inválido para "${row.client_name}".`, imported: 0 };
      }
      clientId = row.client_id;
      // Only require/persist a document_id here if this client didn't
      // already have one — never overwrite an existing value.
      if (!existingDocumentIds.get(clientId)) {
        if (!documentId) {
          return { error: `Falta la cédula/documento de "${row.client_name}".`, imported: 0 };
        }
        clientDocuments.push({ client_id: clientId, document_id: documentId });
        // Para que una segunda fila del mismo cliente no lo pida otra vez.
        existingDocumentIds.set(clientId, documentId);
      }
    } else if (keyByName.has(cacheKey)) {
      clientKey = keyByName.get(cacheKey)!;
    } else {
      if (!documentId) {
        return { error: `Falta la cédula/documento de "${row.client_name}".`, imported: 0 };
      }

      const normalizedDocumentId = normalizeDocumentId(documentId);
      const choques = clientsByNormalizedDocumentId.get(normalizedDocumentId) ?? [];
      // CT-33: UN CLIENTE OCULTO YA NO ES UN MURO.
      //
      // La 077 lo bloqueaba aunque viniera confirmado, con el argumento de que
      // un segundo registro parte un historial. El argumento era bueno MIENTRAS
      // la pantalla no pudiera enseñarlo: la revision leia `client_summary`, que
      // esconde a los ocultos, asi que el aviso nombraba a alguien que no se
      // veia por ningun lado y mandaba a otra pantalla a arreglarlo.
      //
      // Ahora la revision lee `client_summary_all` y el oculto sale como
      // candidato, con su marca y su saldo. Con la ficha delante, decir "es una
      // cuenta separada" es una decision informada, igual que con un cliente
      // vivo — y tratarla distinto seria paternalismo con una pantalla que ya
      // no hace falta. Decidido con el usuario el 2026-10-02.
      // DOS CLIENTES DE ESTA MISMA LIBRETA CON LA MISMA CÉDULA se bloquean
      // SIEMPRE, con confirmación o sin ella, porque la propia `import_libreta`
      // los rechaza (`documento_repetido_en_lote`) y dejarlos pasar aquí sería
      // prometer en pantalla algo que revienta al final del viaje. Y no es el
      // caso que la 034 quiso permitir: ahí son dos libros de una persona
      // creados a lo largo del tiempo, no dos renglones de la misma página.
      const otroDeLaTanda = choques.find((c) => c.enLaTanda);
      if (otroDeLaTanda) {
        return {
          error: `"${row.client_name.trim()}" y "${otroDeLaTanda.name}" llevan la misma cédula en esta libreta. Cada persona necesita la suya.`,
          imported: 0,
        };
      }
      // CT-30: el mensaje ya no manda a «la tabla» —esa pantalla se borro en
      // `7274c93`— sino a donde se responde de verdad. Y solo llega aqui quien
      // se salto la pregunta: una carrera, o un borrador abierto antes de que
      // el otro cliente existiera. Lo normal es que la revision ya la haya
      // hecho y esto no se vea nunca.
      if (choques.length > 0 && !row.confirm_duplicate) {
        const nombres = choques.map((c) => c.name).join(", ");
        return {
          error:
            choques.length === 1
              ? `Ya tienes a ${nombres} con esta cédula. Abre ${row.client_name} en la revisión y dinos si es la misma persona o una cuenta aparte.`
              : `Ya tienes ${choques.length} clientes con esta cédula (${nombres}). Abre ${row.client_name} en la revisión y dinos de cuál es, o si es una cuenta aparte.`,
          imported: 0,
        };
      }

      clientKey = `c${clientsNew.length}`;
      keyByName.set(cacheKey, clientKey);
      clientsNew.push({
        key: clientKey,
        name: row.client_name.trim(),
        document_id: documentId,
        // Opcional: `null` si el dueño no lo escribió en la revisión, que es
        // lo normal. La columna admite nulos desde siempre.
        whatsapp: row.whatsapp?.trim() || null,
        document_country: ownerCountry,
        // Viaja hasta `import_libreta` (migracion 077): la comprobacion de
        // arriba corre ANTES del viaje y la de dentro de la funcion es la que
        // caza las carreras, asi que las dos tienen que conocer la respuesta o
        // la segunda rechazaria lo que la primera acaba de permitir.
        confirm_duplicate: Boolean(row.confirm_duplicate),
      });
      // Se apunta con la clave temporal en vez del id, que aún no existe: lo
      // que importa de este índice es detectar el choque, no a quién señala.
      //
      // Y se AÑADE, no se pisa (CT-29b): pisando, el segundo choque de la misma
      // cédula borraba el primero del índice.
      const yaEnElIndice = clientsByNormalizedDocumentId.get(normalizedDocumentId);
      const recienCreado = {
        id: clientKey,
        name: row.client_name.trim(),
        hidden: false,
        enLaTanda: true,
      };
      if (yaEnElIndice) yaEnElIndice.push(recienCreado);
      else clientsByNormalizedDocumentId.set(normalizedDocumentId, [recienCreado]);
    }

    // El WhatsApp de un cliente que YA existe. Los nuevos lo llevan en su
    // propia entrada, arriba.
    //
    // La función lo escribe con `whatsapp is null` en el WHERE, así que no
    // puede pisar un número ya guardado ni aunque dos filas de la misma tanda
    // traigan números distintos: el de la libreta puede ser más viejo que el
    // que el dueño corrigió a mano en la ficha, y en esa duda gana siempre lo
    // que ya estaba.
    const numero = row.whatsapp?.trim();
    if (numero && clientId) {
      clientWhatsapps.push({ client_id: clientId, whatsapp: numero });
    }

    // No needs_review here: the owner already saw and could fix every
    // flagged row in the import review screen before confirming, so
    // confirming the import *is* the review — defaults to false in the DB.
    const resolved = snapshots.get(row.currency ?? "COP")!;

    movements.push({
      client_id: clientId,
      client_key: clientKey,
      type: row.type,
      amount: row.amount,
      currency: resolved.currency,
      description: row.description,
      rate_mode_used: resolved.rateModeUsed,
      exchange_rate_used: resolved.exchangeRateUsed,
      official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
      entry_currency: resolved.entryCurrency,
      entry_amount: resolved.entryCurrency ? row.amount : null,
      rate_usd_at_time: resolved.rateUsdAtTime,
      rate_eur_at_time: resolved.rateEurAtTime,
      owner_note: row.owner_note?.trim() || null,
      created_at: row.created_at ?? null,
    });
  }

  // ── La única escritura, y es una ──────────────────────────────────────
  const { data, error: rpcError } = await supabase.rpc("import_libreta", {
    p_payload: {
      // CT-33. Los que se restauran en la misma transaccion que la escritura:
      // si la importacion falla, no se restaura a nadie. Hacerlo antes, desde
      // aqui, dejaria al cliente de vuelta en la cartera con un "no se guardo
      // nada" en pantalla — que seria mentira.
      restore_clients: [...restoreClientIds],
      clients_new: clientsNew,
      client_documents: clientDocuments,
      client_whatsapps: clientWhatsapps,
      movements,
    },
  });

  if (rpcError) {
    // Una excepción dentro de la función: ya deshizo todo lo suyo. Lo que el
    // dueño necesita saber cabe en media frase, y es justo lo que antes no se
    // le podía decir. El detalle va al log, no a la pantalla.
    console.error("import_libreta:", rpcError);
    return {
      error: "No pudimos subir la libreta. No se guardó nada, puedes intentarlo otra vez.",
      imported: 0,
    };
  }

  const resultado = data as {
    ok: boolean;
    code?: string;
    client_name?: string;
    hidden?: boolean;
    imported?: number;
    clients_created?: number;
  };

  if (!resultado.ok) {
    return { error: mensajeDeImportacion(resultado), imported: 0 };
  }

  const imported = resultado.imported ?? 0;

  // The photo-import path had no analytics at all: an owner who works mainly
  // from their libreta could import dozens of movements and register as
  // completely inactive. One event per confirmed import rather than one per
  // row — the batch is the meaningful action, and per-row events would be a
  // burst of near-identical noise.
  trackServer(
    "Import Confirmed",
    user.id,
    { movements_imported: imported, clients_created: resultado.clients_created ?? 0 },
    user.email,
  );

  revalidatePath("/dashboard");
  return { error: null, imported };
}

// El castellano de los rechazos de `import_libreta()`.
//
// La función devuelve un `code` y los datos para armar la frase, y no la frase:
// el copy que lee el tendero se cambia aquí, sin una migración, y no hay dos
// idiomas conviviendo dentro de un archivo .sql. Mismo patrón que los `skip` de
// `whatsapp_send_begin`.
//
// Casi todos estos casos los caza ya la comprobación de arriba, que corre antes
// del viaje. Llegan aquí los que se le escapan: una carrera —el cliente se fue a
// la papelera en otra pestaña mientras la revisión estaba abierta— o un payload
// que no salió de esta pantalla.
function mensajeDeImportacion(r: { code?: string; client_name?: string; hidden?: boolean }): string {
  switch (r.code) {
    case "sin_sesion":
      return "Sesión expirada, vuelve a entrar.";
    case "cuenta_pausada":
      return MENSAJE_CUENTA_PAUSADA;
    case "sin_movimientos":
      return "No hay movimientos para subir.";
    case "cliente_invalido":
      return "Uno de los clientes de esta libreta ya no está disponible. Vuelve a abrir la revisión.";
    case "cliente_en_papelera":
      // CT-33: ya no manda a Papelera. Aqui solo se llega por una carrera —se
      // oculto en otra pestaña mientras la revision estaba abierta—, y la
      // salida util es volver a abrirla, donde ahora saldra la pregunta.
      return `${r.client_name ?? "Un cliente"} salió de tu cartera mientras revisabas. Vuelve a abrir la revisión para decidir qué hacer con él.`;
    case "falta_nombre":
      return "Hay una fila sin nombre de cliente.";
    case "falta_documento":
      return `Falta la cédula/documento de "${r.client_name ?? "un cliente"}".`;
    case "documento_de_otro_cliente":
      // CT-30: igual que su gemelo de arriba, ya no manda a una tabla que se
      // borro en `7274c93`. Este lado es el de la carrera pura —alguien creo
      // ese cliente en otra pestaña mientras la revision estaba abierta—, asi
      // que lo util es decir que vuelva a abrirla, donde ahora si saldra la
      // pregunta.
      return r.hidden
        ? `${r.client_name} ya tiene esta cédula y está en la papelera. Restáuralo desde Papelera para poder subir esta libreta.`
        : `${r.client_name} ya tiene esta cédula. Vuelve a abrir la revisión para decirnos si es la misma persona o una cuenta aparte.`;
    case "documento_repetido_en_lote":
      return `Hay dos clientes con la misma cédula en esta libreta, uno de ellos "${r.client_name ?? ""}". Cada persona necesita la suya.`;
    case "referencia_invalida":
      return "Un movimiento quedó sin cliente. Vuelve a abrir la revisión.";
    default:
      return "No pudimos subir la libreta. No se guardó nada, puedes intentarlo otra vez.";
  }
}
