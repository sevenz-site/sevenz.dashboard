"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, normalizeDocumentId } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { convertirDesdeBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { trackServer } from "@/lib/mixpanel-server";
import { recordMovementRejection } from "@/lib/movement-rejection";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { DOCUMENT_SOURCE, type LedgerCurrency } from "@/lib/types";

export type MovementFormState = {
  error: string | null;
  clientId: string | null;
  // Present only when error is the "duplicate document_id" case — lets the
  // dialog offer a direct "go to this client" action instead of a dead end.
  duplicate?: { id: string; name: string } | null;
};

type ParsedMovement =
  | { error: string }
  | {
      error: null;
      type: "charge" | "payment";
      amount: number;
      // Absent means the owner is 'CO' (plain COP, no currency select shown
      // at all) — validated against the owner's actual country below, not
      // trusted from the form alone.
      currency: LedgerCurrency | null;
      // En qué moneda ESCRIBIÓ el dueño. "VES" significa que tecleo bolivares y
      // que `amount` son bolívares que hay que convertir antes de guardar; en
      // los otros dos casos `amount` ya está en la moneda del libro.
      //
      // Es distinto de `currency`, que es el LIBRO donde entra la deuda. Un
      // fiado tecleado en bolívares que va al libro de dólares tiene
      // moneda_tecleada = VES y currency = USD.
      monedaTecleada: "VES" | LedgerCurrency | null;
      description: string | null;
      photoPath: string | null;
      plazoDias: number | null;
    };

// Un rango, no una lista. El desplegable ofrece 7, 15, 30 y 45 porque son los
// plazos que se acuerdan de verdad, pero desde que existe "Otro plazo…" el
// dueño puede escribir 20 o 60 — y una lista fija los rechazaría con un error
// que no explica nada.
//
// Sigue habiendo límites: cero o negativo no es un plazo, y más de un año es
// casi siempre un dedo de más al teclear. El plazo alimenta el puntaje del
// cliente, así que un número absurdo no es inofensivo.
const PLAZO_MIN_DIAS = 1;
const PLAZO_MAX_DIAS = 365;
const ALLOWED_CURRENCIES: LedgerCurrency[] = ["USD", "EUR"];

function parseMovementFields(formData: FormData): ParsedMovement {
  const type = String(formData.get("type") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const currencyRaw = formData.get("movement_currency");
  const description = String(formData.get("description") ?? "").trim();
  const photoPath = String(formData.get("photo_path") ?? "").trim();
  const plazoRaw = String(formData.get("plazo_dias") ?? "");

  if (type !== "charge" && type !== "payment") {
    return { error: "Selecciona el tipo de movimiento." };
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Ingresa un monto válido." };
  }
  const currency = ALLOWED_CURRENCIES.includes(currencyRaw as LedgerCurrency)
    ? (currencyRaw as LedgerCurrency)
    : null;

  // A payment has no payment term. A charge's plazo is only ever what the
  // form actually submitted — "sin_especificar" (or missing) means null.
  let plazoDias: number | null = null;
  if (type === "charge" && plazoRaw && plazoRaw !== "sin_especificar") {
    const parsed = Number(plazoRaw);
    if (!Number.isInteger(parsed) || parsed < PLAZO_MIN_DIAS || parsed > PLAZO_MAX_DIAS) {
      return { error: `El plazo tiene que ser un número de días entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}.` };
    }
    plazoDias = parsed;
  }

  const tecleadaRaw = String(formData.get("moneda_tecleada") ?? "");
  const monedaTecleada =
    tecleadaRaw === "VES" || tecleadaRaw === "USD" || tecleadaRaw === "EUR" ? tecleadaRaw : null;

  return {
    error: null,
    type,
    amount,
    currency,
    monedaTecleada,
    description: description || null,
    photoPath: photoPath || null,
    plazoDias,
  };
}

// Creates a brand-new client together with their first movement.
export async function createClientWithMovement(
  _prevState: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", clientId: null };

  // La cuenta pausada se para AQUÍ, antes de tocar nada.
  //
  // La política de la 061 también lo para, pero de dos maneras distintas y
  // ninguna sirve para enseñarla: un insert rechazado vuelve como "new row
  // violates row-level security policy", y un update rechazado no vuelve como
  // error en absoluto — afecta a cero filas y la pantalla diría que se guardó.
  // Esa segunda es la peligrosa. Preguntando antes, los dos casos dicen lo
  // mismo, y lo dicen en castellano.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { error: MENSAJE_CUENTA_PAUSADA, clientId: null };
  }

  const name = String(formData.get("new_client_name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  // Inherited from the owner's own country rather than asked for in the
  // form: which country issued a client's cédula is a database concern, not
  // something a shop owner thinks about mid-sale, and it's only consulted by
  // the (currently paused) cross-owner identity matching. Read server-side
  // instead of via a hidden input so the browser can't set it at all.
  // Nothing in the UI overrides this today — a cross-border client (a
  // Venezuelan cédula at a Colombian shop) will inherit the wrong country
  // until the matching work resumes and gives the field a visible purpose.
  const { data: ownerRow } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();
  const documentCountry = (ownerRow?.country as string | undefined) ?? null;

  if (!name) {
    return { error: "Escribe el nombre del cliente.", clientId: null };
  }
  // El WhatsApp dejó de ser obligatorio el 2026-09-21, y la razón es de datos,
  // no de comodidad: al exigirlo, quien no lo sabía lo inventaba. En dev había
  // NUEVE clientes compartiendo un mismo número. Un hueco es honesto y se puede
  // pedir después; un número falso es indistinguible de uno bueno, sobrevive
  // para siempre, y el día que se enciendan los avisos al cliente le manda la
  // deuda de alguien a un tercero.
  //
  // La base ya lo permitía (`clients.whatsapp` es nullable) y la importación
  // nunca lo pidió, así que esto alinea las dos puertas de alta en vez de
  // abrir una nueva.
  if (!documentId) {
    return { error: "Escribe la cédula o documento del cliente.", clientId: null };
  }

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, currency, monedaTecleada, description, photoPath, plazoDias } = fields;
  let amount = fields.amount;

  // A brand-new client has no prior debt, so there's nothing to pay off yet.
  if (type === "payment") {
    return { error: "Un cliente nuevo no puede empezar con un abono — todavía no debe nada.", clientId: null };
  }

  // Most of the time the same document_id under one owner is an accidental
  // duplicate (a typo, forgetting the client already exists) — catch it
  // here. But it can also be deliberate: an informal business with no legal
  // registration of its own is sometimes tracked as a second, separate
  // ledger under the same owner (e.g. "Pepito" personal vs. "Pepito
  // negocio"). So this only blocks silently the first time — the owner can
  // explicitly confirm it's a separate account via confirm_duplicate.
  // Compared normalized (punctuation/case-insensitive) since document_id is
  // stored exactly as typed, with no fixed format.
  const normalizedDocumentId = normalizeDocumentId(documentId);
  const confirmDuplicate = formData.get("confirm_duplicate") === "true";
  // Hidden clients are deliberately included here. Excluding them would let an
  // owner re-create someone they had hidden and start their history over —
  // which is the one thing keeping the identity (decision D1) is meant to
  // prevent — and would leave one person split across two records.
  const { data: ownerClients } = await supabase
    .from("clients")
    .select("id, name, document_id, trashed_at, deleted_at")
    .eq("owner_id", user.id)
    .not("document_id", "is", null);
  const duplicate = ownerClients?.find(
    (c) => c.document_id && normalizeDocumentId(c.document_id as string) === normalizedDocumentId,
  );
  if (duplicate && !confirmDuplicate) {
    const hidden = Boolean(duplicate.trashed_at || duplicate.deleted_at);
    return {
      error: hidden
        ? `${duplicate.name} ya tiene esta cédula y está en la papelera. Restáuralo desde Papelera en vez de crearlo otra vez.`
        : `Ya existe un cliente con esta cédula: ${duplicate.name}`,
      clientId: null,
      duplicate: { id: duplicate.id as string, name: duplicate.name as string },
    };
  }

  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      owner_id: user.id,
      name,
      whatsapp: whatsapp || null,
      address: address || null,
      document_id: documentId || null,
      // Always typed by the shopkeeper at registration. See supabase/063.
      document_source: documentId ? DOCUMENT_SOURCE.OWNER : null,
      document_country: documentCountry,
    })
    .select("id")
    .single();

  if (clientError || !newClient) {
    return {
      error: `No pudimos crear el cliente: ${clientError?.message ?? "error desconocido"}`,
      clientId: null,
    };
  }

  // La casilla "aplicar tasa BCV prevista". Llega como marca, no como cifra:
  // resolveMovementRateSnapshot busca la tasa en lo que el servidor ya guardó.
  const usarPrevista = formData.get("usar_tasa_prevista") === "1";
  const resolucion = await resolveMovementRateSnapshot(supabase, user.id, currency, usarPrevista);
  if (!resolucion.ok) {
    await recordMovementRejection(supabase, {
      reason: resolucion.reason,
      source: "cliente_nuevo",
      userId: user.id,
      userEmail: user.email,
      clientId: newClient.id,
      amount,
      attemptedCurrency: currency,
    });
    // El cliente ya se creó arriba, y se queda: borrarlo por no poder escribir
    // el primer movimiento perdería los datos de contacto que el dueño acaba
    // de teclear. Vuelve a intentarlo eligiendo la moneda y el cliente ya está.
    return { error: resolucion.error, clientId: newClient.id };
  }
  const resolved = resolucion.snapshot;

  // Bolívares tecleados: se convierten AQUÍ, con la misma tasa que se acaba de
  // sellar —incluida la prevista si el dueño marco la casilla—, para que el
  // respaldo y la cifra guardada no puedan discrepar.
  let entryAmount: number | null = null;
  let entryCurrency: "VES" | LedgerCurrency | null = resolved.entryCurrency;
  if (monedaTecleada === "VES" && currency) {
    const convertido = convertirDesdeBolivares(amount, currency, resolved);
    if ("error" in convertido) return { error: convertido.error, clientId: null };
    amount = convertido.monto;
    entryAmount = convertido.entryAmount;
    entryCurrency = "VES";
  }

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: newClient.id,
    created_by: user.id,
    type,
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: entryCurrency,
    // Los bolívares tal cual se escribieron cuando se tecleó en bolívares; si no,
    // el mismo monto, que es lo que hacia antes.
    entry_amount: entryAmount ?? (entryCurrency ? amount : null),
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
  });

  if (movementError) {
    return { error: `No pudimos guardar el movimiento: ${movementError.message}`, clientId: null };
  }

  // Tracked here rather than in the browser: this fires after the response
  // is sent (see trackServer), so it can't slow or break the save, and no
  // blocker or iOS setting can suppress it the way it does the client-side
  // version.
  trackServer("Client Created", user.id, { client_id: newClient.id }, user.email);

  revalidatePath("/dashboard");
  return { error: null, clientId: newClient.id };
}

// Adds a movement to a client that already exists (from the client detail page).
export async function addMovement(
  _prevState: MovementFormState,
  formData: FormData,
): Promise<MovementFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", clientId: null };

  // La cuenta pausada se para AQUÍ, antes de tocar nada.
  //
  // La política de la 061 también lo para, pero de dos maneras distintas y
  // ninguna sirve para enseñarla: un insert rechazado vuelve como "new row
  // violates row-level security policy", y un update rechazado no vuelve como
  // error en absoluto — afecta a cero filas y la pantalla diría que se guardó.
  // Esa segunda es la peligrosa. Preguntando antes, los dos casos dicen lo
  // mismo, y lo dicen en castellano.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { error: MENSAJE_CUENTA_PAUSADA, clientId: null };
  }

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { error: "Cliente inválido.", clientId: null };

  // Nothing requires a client's WhatsApp at creation time, so a real backlog
  // of clients has none on file. Backfilling it here (rather than a one-off
  // nag screen) piggybacks on something every owner already does routinely
  // — only asked for this specific client when it's missing; a client who
  // already has one sees no change to this form at all.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("whatsapp, trashed_at, deleted_at")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!clientRow) return { error: "Cliente inválido.", clientId: null };
  // A movement written to a hidden client lands somewhere no list shows and
  // no total counts — the owner would see a success toast and nothing else.
  // The client detail page already hides the form for a trashed client; this
  // is the guard behind it, since the form is reachable by other routes.
  if (clientRow.trashed_at || clientRow.deleted_at) {
    return { error: "Este cliente está en la papelera. Restáuralo para registrar movimientos.", clientId: null };
  }

  // Se sigue OFRECIENDO para el cliente que no tiene número, y se guarda si el
  // dueño lo escribe — pero ya no bloquea. Exigirlo aquí habría dejado el
  // primer movimiento de cada cliente importado esperando un dato que la
  // importación no pide.
  if (!clientRow.whatsapp) {
    const whatsapp = String(formData.get("whatsapp") ?? "").trim();
    if (whatsapp) {
      const { error: whatsappError } = await supabase
      .from("clients")
        .update({ whatsapp })
        .eq("id", clientId)
        .eq("owner_id", user.id);
      if (whatsappError) {
        return { error: `No pudimos guardar el WhatsApp: ${whatsappError.message}`, clientId: null };
      }
    }
  }

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, currency, monedaTecleada, description, photoPath, plazoDias } = fields;
  let amount = fields.amount;

  // La casilla "aplicar tasa BCV prevista". Llega como marca, no como cifra:
  // resolveMovementRateSnapshot busca la tasa en lo que el servidor ya guardó.
  const usarPrevista = formData.get("usar_tasa_prevista") === "1";
  const resolucion = await resolveMovementRateSnapshot(supabase, user.id, currency, usarPrevista);
  if (!resolucion.ok) {
    await recordMovementRejection(supabase, {
      reason: resolucion.reason,
      source: "movimiento",
      userId: user.id,
      userEmail: user.email,
      clientId,
      amount,
      attemptedCurrency: currency,
    });
    return { error: resolucion.error, clientId: null };
  }
  const resolved = resolucion.snapshot;

  // Bolívares tecleados: se convierten AQUÍ, con la misma tasa que se acaba de
  // sellar —incluida la prevista si el dueño marco la casilla—, para que el
  // respaldo y la cifra guardada no puedan discrepar.
  let entryAmount: number | null = null;
  let entryCurrency: "VES" | LedgerCurrency | null = resolved.entryCurrency;
  if (monedaTecleada === "VES" && currency) {
    const convertido = convertirDesdeBolivares(amount, currency, resolved);
    if ("error" in convertido) return { error: convertido.error, clientId: null };
    amount = convertido.monto;
    entryAmount = convertido.entryAmount;
    entryCurrency = "VES";
  }

  // A payment can never exceed what the client currently owes in that SAME
  // currency — a dollar payment can't pay off a euro debt, since they're
  // independent ledgers. is("currency", ...) / eq("currency", ...) below
  // scopes the lookup to the right one (null = the CO owner's plain ledger).
  if (type === "payment") {
    let balanceQuery = supabase
      .from("movements")
      .select("running_balance")
      .eq("client_id", clientId)
      .is("deleted_at", null);
    balanceQuery = resolved.currency
      ? balanceQuery.eq("currency", resolved.currency)
      : balanceQuery.is("currency", null);

    const { data: latest } = await balanceQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentDebt = Number(latest?.running_balance ?? 0);
    if (currentDebt <= 0) {
      return {
        error: "Este cliente no debe nada en esta moneda, por eso no se puede registrar un abono.",
        clientId: null,
      };
    }
    if (amount > currentDebt) {
      const formattedDebt = resolved.currency
        ? formatDisplayCurrency(currentDebt, resolved.currency)
        : formatCurrency(currentDebt);
      return {
        error: `El abono no puede ser mayor a lo que debe (${formattedDebt}).`,
        clientId: null,
      };
    }
  }

  const { error: movementError } = await supabase.from("movements").insert({
    client_id: clientId,
    created_by: user.id,
    type,
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: entryCurrency,
    // Los bolívares tal cual se escribieron cuando se tecleó en bolívares; si no,
    // el mismo monto, que es lo que hacia antes.
    entry_amount: entryAmount ?? (entryCurrency ? amount : null),
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
  });

  if (movementError) {
    return { error: `No pudimos guardar el movimiento: ${movementError.message}`, clientId: null };
  }

  trackServer("Movement Added", user.id, { client_id: clientId, movement_type: type }, user.email);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${clientId}`);
  return { error: null, clientId };
}

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
export async function deleteMovement(movementId: string): Promise<{ error: string | null }> {
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

  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id")
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos ese movimiento." };
  }

  const { error: deleteError } = await supabase
    .from("movements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", movementId);

  if (deleteError) {
    return { error: `No pudimos eliminar el movimiento: ${deleteError.message}` };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: `No pudimos recalcular el saldo: ${recalcError.message}` };
  }

  const { error: notifyError } = await supabase.from("movement_deletions").insert({
    movement_id: movementId,
    owner_id: user.id,
    client_id: movement.client_id,
  });
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

  const { data: movement, error: fetchError } = await supabase
    .from("movements")
    .select("id, client_id")
    .eq("id", movementId)
    .not("deleted_at", "is", null)
    .maybeSingle();

  if (fetchError || !movement) {
    return { error: "No encontramos ese movimiento eliminado." };
  }

  const { error: restoreError } = await supabase
    .from("movements")
    .update({ deleted_at: null })
    .eq("id", movementId);

  if (restoreError) {
    return { error: `No pudimos restaurar el movimiento: ${restoreError.message}` };
  }

  const { error: recalcError } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: movement.client_id,
  });
  if (recalcError) {
    return { error: `No pudimos recalcular el saldo: ${recalcError.message}` };
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
