"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { convertirDesdeBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { after } from "next/server";
import { trackServer } from "@/lib/mixpanel-server";
import { enviarReciboAlCliente } from "@/lib/whatsapp/recibo-cliente";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD } from "@/lib/whatsapp-opt-in";
import { guardarPermisoDeclarado } from "@/lib/whatsapp/declared-consent";
import { recordMovementRejection } from "@/lib/movement-rejection";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { isDocumentTypeFor } from "@/lib/document-id";
import { buscarDocumentoDuplicado, mensajeDeDuplicado } from "@/lib/clients/duplicate-document";
import { DOCUMENT_SOURCE, type LedgerCurrency } from "@/lib/types";
import { mensajeDeError } from "@/lib/errores-legibles";
import type { LineaDeProducto } from "@/lib/sale-lines";

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
      // En cuántas cuotas se pactó. null = sin cuotas = una sola.
      cuotas: number | null;
      // Qué se llevó el cliente. Lista vacía = no se eligió ningún producto,
      // que es el caso de la mayoría: 43% de los movimientos de dev llevan
      // siquiera una descripción.
      productos: LineaDeProducto[];
    };

// Un rango, no una lista. El desplegable ofrece 7, 15, 30 y 45 porque son los
// plazos que se acuerdan de verdad, pero desde que existe "Otro plazo…" el
// dueño puede escribir 20 o 60 — y una lista fija los rechazaría con un error
// que no explica nada.
//
// Sigue habiendo límites: cero o negativo no es un plazo, y más de un año es
// casi siempre un dedo de más al teclear. El plazo alimenta el puntaje del
// cliente, así que un número absurdo no es inofensivo.
// ===========================================================================
// QUÉ SE LLEVÓ EL CLIENTE — paso 8, entregable `E` / `CT-51`
//
// Lo que llega del formulario es una cadena JSON en un solo campo, igual que
// el plazo y las cuotas. Aquí se valida entera antes de tocar nada: un dato
// que viene del navegador no decide un precio sin pasar por este filtro.
//
// NUNCA TUMBA EL MOVIMIENTO. Si el JSON no se entiende, se guarda el fiado sin
// productos y el dinero queda registrado. Es la regla dura del plan: romper el
// registro de fiados --lo único que hoy funciona con 24 negocios-- por una
// función nueva es el peor resultado posible.
const PRODUCTOS_MAX_LINEAS = 50;
const PRODUCTO_NOMBRE_MAX = 120;

function parsearProductos(bruto: string): LineaDeProducto[] {
  if (!bruto) return [];
  let crudo: unknown;
  try {
    crudo = JSON.parse(bruto);
  } catch {
    console.error("parsearProductos: JSON invalido");
    return [];
  }
  if (!Array.isArray(crudo)) return [];

  const lineas: LineaDeProducto[] = [];
  for (const item of crudo.slice(0, PRODUCTOS_MAX_LINEAS)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const quantity = Number(o.quantity);
    const unitPrice = Number(o.unitPrice);
    const productId = typeof o.productId === "string" && o.productId ? o.productId : null;

    if (name === "" || name.length > PRODUCTO_NOMBRE_MAX) continue;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) continue;
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1e11) continue;

    lineas.push({ productId, name, quantity, unitPrice });
  }
  return lineas;
}

// Guarda las líneas de un movimiento ya creado, dando de alta los productos
// que el tendero escribió en el momento.
//
// EL `owner_id` SALE DE LA SESIÓN Y NUNCA DEL NAVEGADOR, y cada `productId`
// que llega se comprueba contra los productos de ESE dueño: un id ajeno se
// descarta y la línea se guarda igual, con su nombre y su precio, pero sin
// apuntar al producto de otro.
//
// SU ERROR NO SE TRAGA EN SILENCIO del todo: se registra en el log Y se
// devuelve, para que quien llame decida. Hoy nadie tumba el movimiento por
// esto --ya está guardado y el dinero es lo que importa-- pero el día que haga
// falta avisar en pantalla, el dato está. Es la lección de `CT-88`.
//
// ===========================================================================
// ESTO CREA UNA VENTA, Y HASTA EL 2026-10-17 INSERTABA EN `movement_products`
//
// Un fiado manual es ahora «una venta sin pago»: se crea la fila en `sales`,
// sus `sale_lines`, y se apunta el movimiento a ella con `sale_id`.
//
// POR QUÉ CAMBIÓ: una venta pagada al contado no escribe NADA en `movements`
// —el recálculo del saldo no tiene fila neutra, ver la migración `124`— así
// que sus productos no tenían movimiento del que colgar. Con dos tablas, cada
// pantalla que quisiera enseñar «qué se llevó» tendría que mirar en las dos o
// quedarse a medias.
//
// EL ORDEN IMPORTA Y ES EL MISMO DE ANTES: el dinero primero. Cuando esto
// corre, el movimiento ya existe y el saldo ya es correcto. Si algo de aquí
// falla, se pierde el detalle de la compra y nunca la deuda.
async function guardarVentaDelMovimiento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  clientId: string,
  movementId: string,
  lineas: LineaDeProducto[],
  // EL LIBRO DEL MOVIMIENTO, que es la moneda base del producto que nazca
  // aquí. `null` es el único libro de un negocio colombiano, y ahí la base es
  // el peso. Sin esto el alta falla con `base_currency ... not-null`, que es
  // exactamente lo que pasó la primera vez que se probó: el fiado se guardó
  // bien, la línea también, y solo se perdió el enlace con el inventario --
  // en silencio, porque este error no tumba el movimiento a propósito.
  ledger: LedgerCurrency | null,
): Promise<{ error: string | null }> {
  if (lineas.length === 0) return { error: null };

  const idsPedidos = [...new Set(lineas.map((l) => l.productId).filter((v): v is string => v !== null))];
  let idsPropios = new Set<string>();
  if (idsPedidos.length > 0) {
    const { data } = await supabase
      .from("products")
      .select("id")
      .eq("owner_id", ownerId)
      .in("id", idsPedidos);
    idsPropios = new Set((data ?? []).map((p) => p.id));
  }

  // LA VENTA, antes que sus líneas. Si esto falla no hay dónde colgarlas y se
  // sale: el movimiento ya está guardado y el saldo ya es correcto.
  const { data: venta, error: errorVenta } = await supabase
    .from("sales")
    .insert({ owner_id: ownerId, client_id: clientId, created_by: ownerId })
    .select("id")
    .single();
  if (errorVenta || !venta) {
    console.error("guardarVentaDelMovimiento: alta de venta:", errorVenta?.message);
    return { error: "No pudimos guardar los productos de esta transacción." };
  }

  const filas: { sale_id: string; product_id: string | null; name: string; quantity: number; unit_price: number; currency: string }[] = [];

  for (const l of lineas) {
    let productId = l.productId && idsPropios.has(l.productId) ? l.productId : null;

    // ALTA MÍNIMA, decisión 11 del dueño del 2026-10-09: nace CREADO con
    // nombre y precio, exactamente como si se hubiera dado de alta desde su
    // ficha. Si el alta falla, la línea se guarda igual sin `product_id`: el
    // fiado dice qué se llevó aunque el inventario no se haya enterado.
    if (productId === null && l.productId === null) {
      const { data: creado, error } = await supabase
        .from("products")
        .insert({
          owner_id: ownerId,
          name: l.name,
          price_retail: l.unitPrice,
          // Las dos, porque desde la `114` el precio al detal lee
          // `base_currency_retail` y `base_currency` sigue siendo el valor por
          // defecto del producto.
          base_currency: ledger ?? "COP",
          base_currency_retail: ledger ?? "COP",
        })
        .select("id")
        .single();
      if (error) console.error("guardarVentaDelMovimiento: alta de producto:", error.message);
      else productId = creado.id;
    }

    filas.push({
      sale_id: venta.id,
      product_id: productId,
      name: l.name,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      // LA MONEDA DE LA LÍNEA ES LA DEL LIBRO DEL MOVIMIENTO. Un fiado manual
      // es de una sola moneda --la que el formulario eligió-- así que todas
      // sus líneas comparten libro. La venta del sitemap sí admite una moneda
      // por línea, y ese es el camino que esta función todavía no cubre.
      //
      // `COP` donde el libro es `null`, que es el único libro de un negocio
      // colombiano: la columna de `sale_lines` no admite nulos porque una
      // línea sin moneda no se puede sumar con nada.
      currency: ledger ?? "COP",
    });
  }

  const { error } = await supabase.from("sale_lines").insert(filas);
  if (error) {
    console.error("guardarVentaDelMovimiento: lineas:", error.message);
    return { error: "No pudimos guardar los productos de esta transacción." };
  }

  // EL ENLACE, AL FINAL. Si esto falla, la venta y sus líneas existen y solo
  // se pierde el puente desde el movimiento -- recuperable, al contrario que
  // un saldo mal calculado.
  const { error: errorEnlace } = await supabase
    .from("movements")
    .update({ sale_id: venta.id })
    .eq("id", movementId);
  if (errorEnlace) {
    console.error("guardarVentaDelMovimiento: enlace:", errorEnlace.message);
  }

  return { error: null };
}

const PLAZO_MIN_DIAS = 1;
const PLAZO_MAX_DIAS = 365;
// CUÁNTAS CUOTAS COMO MUCHO. El tope es el mismo de la migración `118` y no
// una validación de más: sin él, el `check` de la base rechaza el insert y el
// dueño ve «No pudimos guardar» sin saber qué corregir. 36 es tres años
// pagando una vez al mes, que ya está fuera de lo que este producto hace.
const CUOTAS_MIN = 2;
const CUOTAS_MAX = 36;
const ALLOWED_CURRENCIES: LedgerCurrency[] = ["USD", "EUR"];

function parseMovementFields(formData: FormData): ParsedMovement {
  const type = String(formData.get("type") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const currencyRaw = formData.get("movement_currency");
  const description = String(formData.get("description") ?? "").trim();
  const photoPath = String(formData.get("photo_path") ?? "").trim();
  const plazoRaw = String(formData.get("plazo_dias") ?? "");
  const cuotasRaw = String(formData.get("cuotas") ?? "");
  // Solo un fiado lleva productos: decisión del dueño del 2026-10-17, y la
  // migración `122` lo repite con un trigger. En un abono se descartan aquí,
  // antes de llegar a la base.
  const productos = type === "charge" ? parsearProductos(String(formData.get("productos") ?? "")) : [];

  if (type !== "charge" && type !== "payment") {
    return { error: "Selecciona el tipo de transacción." };
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

  // LAS CUOTAS SOLO EXISTEN SOBRE UN PLAZO, que es lo que dividen: «3 cuotas
  // en 30 días» son una cada 10. Sin plazo no hay nada que repartir, así que
  // un fiado «sin especificar» se guarda sin cuotas aunque el formulario
  // mandara un número — y no es un error que haya que enseñarle a nadie,
  // porque el propio formulario esconde el campo en ese caso.
  //
  // Y una cuota es lo mismo que ninguna, así que se guarda null: es la
  // decisión de la migración `118`, que hace que lo de siempre sea el caso
  // N=1 y que no haya dos caminos en el código.
  let cuotas: number | null = null;
  if (type === "charge" && plazoDias !== null && cuotasRaw && cuotasRaw !== "1") {
    const parsedCuotas = Number(cuotasRaw);
    if (!Number.isInteger(parsedCuotas) || parsedCuotas < CUOTAS_MIN || parsedCuotas > CUOTAS_MAX) {
      return { error: `Las cuotas tienen que ser un número entre ${CUOTAS_MIN} y ${CUOTAS_MAX}.` };
    }
    cuotas = parsedCuotas;
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
    cuotas,
    productos,
  };
}

// Creates a brand-new client together with their first movement.
// Lee del formulario lo que el ayudante compartido necesita. La escritura
// vive en lib/whatsapp/declared-consent.ts porque la subida de libreta hace
// exactamente lo mismo desde otra accion.
// EL RECIBO SALE DESPUES DE LA RESPUESTA, NO ANTES (MS-3).
//
// `after()` corre el callback cuando la respuesta ya se envio, igual que
// `trackServer`. Dentro va una llamada a Kapso por internet: hacerla en linea
// dejaria al tendero mirando una rueda mientras un proveedor externo responde
// -- y el tendero vino a registrar un abono, no a mandar un WhatsApp.
//
// SI FALLA, NO PASA NADA PARA EL MOVIMIENTO. El abono ya esta guardado. Lo que
// se pierde es el comprobante, y eso se ve en `whatsapp_sends` con su error.
//
// LO QUE ESTO NO TIENE, dicho para que no se descubra tarde: si el proceso
// muere entre la respuesta y el envio, ese recibo NO se reintenta. La clave de
// idempotencia es el movimiento, asi que un barrido futuro que busque abonos
// sin recibo podria reintentarlo sin riesgo de duplicar -- pero ese barrido no
// existe hoy.
function dispararRecibo(movementId: string, type: string) {
  if (type !== "payment") return;
  after(async () => {
    const r = await enviarReciboAlCliente(movementId);
    // Un "omitido" normal --sin permiso, sin numero, desactivado-- no es un
    // error y no ensucia el log. Un fallido si: significa que el cliente
    // esperaba su comprobante y no le llego.
    if (r.estado === "fallido") console.error("[recibo]", movementId, r.error);
  });
}

function datosDelPermiso(formData: FormData) {
  return {
    seMostro: formData.get(CONSENT_SHOWN_FIELD) != null,
    acepta: formData.get(CONSENT_FIELD) != null,
  };
}

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
  // SOLO DIGITOS, tambien aqui. `DocumentIdInput` ya los filtra en pantalla
  // desde el 2026-09-17, pero el navegador filtrando es una comodidad para
  // quien escribe, no una defensa del servidor. Mismo criterio que la regla
  // de las comprobaciones de propiedad explicitas: la capa de arriba no
  // exime a la de abajo. Ver la migracion 079, que cierra la misma puerta en
  // la unica de las tres que se alcanza sin iniciar sesion.
  const documentId = String(formData.get("document_id") ?? "").replace(/[^0-9]/g, "");
  // EL TIPO DE DOCUMENTO (migración 125). Lo manda el `select` que vive dentro
  // de `DocumentIdInput`, así que llega desde CUALQUIER pantalla que envíe
  // este formulario sin que haya que acordarse de añadirlo — que es la razón
  // de que ese control sea parte del campo y no un prop de cada pantalla.
  //
  // SE VALIDA CONTRA EL PAÍS DEL NEGOCIO, abajo: un 'NIT' llegando de un
  // negocio venezolano es un error o una petición escrita a mano, y en los dos
  // casos se descarta en vez de guardarse.
  const documentTypeRaw = String(formData.get("document_type") ?? "").trim();
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
    return { error: "Escribe la cédula del cliente.", clientId: null };
  }

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, currency, monedaTecleada, description, photoPath, plazoDias, cuotas, productos } = fields;
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
  // LA BÚSQUEDA Y LA FRASE VIVEN EN `lib/clients/duplicate-document.ts` desde
  // el 2026-10-18, cuando la pantalla de cliente nuevo pasó a necesitar lo
  // mismo. No se movió por orden: dos copias de esta comprobación se separan,
  // y lo que se cuela por la que se quede atrás es el MISMO cliente registrado
  // dos veces, con la mitad de lo que debe en cada ficha. El comportamiento es
  // idéntico al de antes, incluidos los ocultos y la comparación normalizada.
  const confirmDuplicate = formData.get("confirm_duplicate") === "true";
  // EL TIPO VIAJA CON EL NÚMERO desde el 2026-10-24, por la misma razón que
  // en la pantalla de cliente nuevo: el prefijo vive en `document_type` y sin
  // él V-070707 y J-070707 se leían como el mismo documento.
  const tipoDelDocumento =
    documentId && isDocumentTypeFor(documentCountry as "VE" | "CO" | null, documentTypeRaw)
      ? documentTypeRaw
      : null;
  const duplicate = await buscarDocumentoDuplicado(
    supabase,
    user.id,
    documentId,
    tipoDelDocumento,
  );
  if (duplicate && !confirmDuplicate) {
    return {
      error: mensajeDeDuplicado(duplicate),
      clientId: null,
      duplicate: { id: duplicate.id, name: duplicate.name },
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
      // Sin documento no hay tipo que guardar: un tipo suelto describiría un
      // número que no existe.
      document_type:
        documentId && isDocumentTypeFor(documentCountry as "VE" | "CO" | null, documentTypeRaw)
          ? documentTypeRaw
          : null,
      // Always typed by the shopkeeper at registration. See supabase/063.
      document_source: documentId ? DOCUMENT_SOURCE.OWNER : null,
      document_country: documentCountry,
    })
    .select("id")
    .single();

  if (clientError || !newClient) {
    return {
      error: mensajeDeError("crear el cliente", clientError, "createClient"),
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

  const { data: movimiento, error: movementError } = await supabase.from("movements").insert({
    client_id: newClient.id,
    created_by: user.id,
    type,
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    cuotas,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: entryCurrency,
    // Los bolívares tal cual se escribieron cuando se tecleó en bolívares; si no,
    // el mismo monto, que es lo que hacia antes.
    entry_amount: entryAmount ?? (entryCurrency ? amount : null),
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
  }).select("id").single();

  if (movementError) {
    return { error: mensajeDeError("guardar la transacción", movementError, "movement"), clientId: null };
  }

  // QUÉ SE LLEVÓ, después de que el dinero esté guardado y nunca antes. Si
  // esto falla, el fiado ya existe y el saldo ya es correcto -- que es el
  // orden que importa.
  await guardarVentaDelMovimiento(supabase, user.id, newClient.id, movimiento.id, productos, resolved.currency);

  // Tracked here rather than in the browser: this fires after the response
  // is sent (see trackServer), so it can't slow or break the save, and no
  // blocker or iOS setting can suppress it the way it does the client-side
  // version.
  trackServer("Client Created", user.id, { client_id: newClient.id }, user.email);

  await guardarPermisoDeclarado(supabase, {
    clientId: newClient.id,
    ownerId: user.id,
    clientName: name,
    source: "owner_movement_form",
    ...datosDelPermiso(formData),
  });

  dispararRecibo(movimiento.id, type);

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
    return { error: "Este cliente está en la papelera. Restáuralo para registrar transacciones.", clientId: null };
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
        return { error: mensajeDeError("guardar el WhatsApp", whatsappError, "whatsapp"), clientId: null };
      }
    }
  }

  const fields = parseMovementFields(formData);
  if (fields.error !== null) return { error: fields.error, clientId: null };
  const { type, currency, monedaTecleada, description, photoPath, plazoDias, cuotas, productos } = fields;
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

  const { data: movimiento, error: movementError } = await supabase.from("movements").insert({
    client_id: clientId,
    created_by: user.id,
    type,
    amount,
    currency: resolved.currency,
    description,
    source: "manual",
    photo_path: photoPath,
    plazo_dias: plazoDias,
    cuotas,
    rate_mode_used: resolved.rateModeUsed,
    exchange_rate_used: resolved.exchangeRateUsed,
    official_bcv_rate_at_time: resolved.officialBcvRateAtTime,
    entry_currency: entryCurrency,
    // Los bolívares tal cual se escribieron cuando se tecleó en bolívares; si no,
    // el mismo monto, que es lo que hacia antes.
    entry_amount: entryAmount ?? (entryCurrency ? amount : null),
    rate_usd_at_time: resolved.rateUsdAtTime,
    rate_eur_at_time: resolved.rateEurAtTime,
  }).select("id").single();

  if (movementError) {
    return { error: mensajeDeError("guardar la transacción", movementError, "movement"), clientId: null };
  }

  // QUÉ SE LLEVÓ, después de que el dinero esté guardado y nunca antes. Si
  // esto falla, el fiado ya existe y el saldo ya es correcto -- que es el
  // orden que importa.
  await guardarVentaDelMovimiento(supabase, user.id, clientId, movimiento.id, productos, resolved.currency);

  trackServer("Movement Added", user.id, { client_id: clientId, movement_type: type }, user.email);

  // El nombre llega del formulario porque la accion no lee el cliente: un
  // SELECT mas en el camino caliente del alta, solo para componer una frase.
  // Si no viene, la funcion de lib/ cae en "El cliente", que es feo pero sigue
  // siendo literalmente lo que se enseno.
  await guardarPermisoDeclarado(supabase, {
    clientId,
    ownerId: user.id,
    // El nombre llega del formulario porque la accion no lee el cliente: un
    // SELECT mas en el camino caliente del alta, solo para componer una frase.
    clientName: String(formData.get("client_name") ?? ""),
    source: "owner_movement_form",
    ...datosDelPermiso(formData),
  });

  dispararRecibo(movimiento.id, type);

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
