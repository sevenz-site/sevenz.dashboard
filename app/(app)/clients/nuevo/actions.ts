"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { buscarDocumentoDuplicado, mensajeDeDuplicado } from "@/lib/clients/duplicate-document";
import { isDocumentTypeFor } from "@/lib/document-id";
import { guardarPermisoDeclarado } from "@/lib/whatsapp/declared-consent";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD } from "@/lib/whatsapp-opt-in";
import { trackServer } from "@/lib/mixpanel-server";
import { mensajeDeError } from "@/lib/errores-legibles";
import { DOCUMENT_SOURCE } from "@/lib/types";
import { createServiceClient } from "@/lib/supabase/service";
import { parseMoneyInput } from "@/lib/products/price";
import {
  resolveMovementRateSnapshot,
  type MovementRateSnapshot,
} from "@/lib/exchange-rate/resolve-movement-rate";

// ===========================================================================
// THE OLD DEBT -- owner's request of 2026-10-30
//
// The case it exists for: a shopkeeper moving his notebook into Sevenz by hand
// registers a client who ALREADY owes him something, without having sold
// anything inside the app. Screen «Información de deuda» (frame `1868:16119`),
// step 2/2 of «Nuevo cliente».
//
// IT IS STORED AS A FIADO, and that was asked, not assumed (owner's answer of
// 2026-10-30): a `charge` with today's date, its own plazo and cuotas, photo
// and description. So it adds to the balance, gets paid with an abono and is
// judged by its term exactly like any fiado -- no new type, no migration.
//
// NO BOLIVARS: the owner chose dollars or euros only (2026-10-30), so the amount
// typed IS the amount stored, in that book. A Colombian business has one book
// and no selector.
//
// ZERO OR EMPTY MEANS «NO OLD DEBT», and then no movement is written at all: a
// `0.00` fiado would be a row that says nothing and shows up in the history.
type DeudaAntigua = {
  amount: number;
  plazoDias: number | null;
  cuotas: number | null;
  photoPath: string | null;
  description: string | null;
  sello: MovementRateSnapshot;
};

async function leerDeudaAntigua(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  formData: FormData,
): Promise<{ ok: true; deuda: DeudaAntigua | null } | { ok: false; error: string }> {
  const texto = String(formData.get("deuda_monto") ?? "").trim();
  if (!texto) return { ok: true, deuda: null };
  const leido = parseMoneyInput(texto);
  if (leido == null || !Number.isFinite(leido) || leido < 0) {
    return { ok: false, error: "Escribe la deuda antigua con números, o déjala en cero." };
  }
  const amount = Math.round(leido * 100) / 100;
  if (amount === 0) return { ok: true, deuda: null };

  // «Sin especificar» travels as its own word and means no term at all.
  const plazoTexto = String(formData.get("plazo_dias") ?? "").trim();
  let plazoDias: number | null = null;
  if (plazoTexto && plazoTexto !== "sin_especificar") {
    const n = Number(plazoTexto);
    // The same 1-365 range as the database (migration 054).
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return { ok: false, error: "Escribe el plazo en días, entre 1 y 365." };
    }
    plazoDias = n;
  }

  // ONE CUOTA AND «SIN ESPECIFICAR» ARE THE SAME ROW: null, which the database
  // reads as a single payment at the end of the term (migration 118).
  const cuotasTexto = String(formData.get("cuotas") ?? "").trim();
  let cuotas: number | null = null;
  if (cuotasTexto && cuotasTexto !== "sin_especificar" && cuotasTexto !== "1") {
    const n = Number(cuotasTexto);
    if (!Number.isInteger(n) || n < 2 || n > 36) {
      return { ok: false, error: "Elige en cuántas cuotas se paga." };
    }
    // The database refuses cuotas without a term (migration 118). Said here in
    // words instead of letting the insert fail with a constraint name.
    if (plazoDias == null) {
      return {
        ok: false,
        error: "Para repartir la deuda en cuotas, elige primero el plazo de pago.",
      };
    }
    cuotas = n;
  }

  // The photo is uploaded by the browser; only a path inside the owner's own
  // folder is accepted -- the same check as `app/(app)/clients/[id]/actions.ts`.
  const photoPath = String(formData.get("deuda_photo_path") ?? "").trim() || null;
  if (photoPath && !photoPath.startsWith(`${ownerId}/`)) {
    return { ok: false, error: "No pudimos adjuntar esa foto. Vuelve a subirla." };
  }

  const monedaTexto = String(formData.get("deuda_moneda") ?? "").trim();
  const moneda = monedaTexto === "USD" || monedaTexto === "EUR" ? monedaTexto : null;
  // THE SAME DOOR EVERY MOVEMENT GOES THROUGH: it decides the book (null for a
  // Colombian business, refused for a Venezuelan one with no currency) and
  // seals the day's rate for the audit columns.
  const resolucion = await resolveMovementRateSnapshot(supabase, ownerId, moneda);
  if (!resolucion.ok) return { ok: false, error: resolucion.error };

  const descripcion = String(formData.get("deuda_descripcion") ?? "").trim().slice(0, 500);
  return {
    ok: true,
    deuda: {
      amount,
      plazoDias,
      cuotas,
      photoPath,
      description: descripcion || null,
      sello: resolucion.snapshot,
    },
  };
}

// UN CLIENTE, Y NADA MÁS. Frame `1389:8313`, encargo del dueño del 2026-10-18.
//
// ===========================================================================
// ESTO NO EXISTÍA, Y ES EL CAMBIO DE FONDO DE LA PANTALLA
//
// Hasta el 2026-10-18 la única forma de crear un cliente era
// `createClientWithMovement`: nacía **con su primer fiado**, con monto, plazo
// y cuotas. Tenía sentido mientras Sevenz fuera un libro de deudas — un cliente
// sin deuda no era nada.
//
// ESA FUNCIÓN YA NO EXISTE: se borró el 2026-10-24 con el resto del diálogo
// viejo. Lo que sigue la nombra para contar de dónde viene esta pantalla, no
// para mandar a nadie a leerla.
//
// Con la venta dentro ya no: el frame no tiene ni un campo de dinero, y
// termina en dos botones —«Registrar y finalizar» y «Continuar con venta»—
// que son exactamente las dos cosas que un tendero quiere después de apuntar a
// alguien. El segundo es además la pieza que faltaba para que un cliente nuevo
// pueda nacer con una VENTA en vez de con un fiado, que era un hueco anotado
// el 2026-10-18 en el paso 1/4 del asistente.
//
// LA OTRA PUERTA SIGUE ABIERTA y no se toca: el diálogo de `?nuevo=1` sigue
// creando cliente + primer movimiento de una vez, que es lo que hace falta
// cuando el tendero ya tiene la deuda delante. Dos puertas, dos situaciones.
// Lo que NO se duplica es la comprobación de duplicados, que vive en
// `lib/clients/duplicate-document.ts` precisamente para que no se separen.
export type ResultadoAlta =
  | { ok: true; clientId: string }
  | { ok: false; error: string; duplicado?: { id: string; name: string } };

// ── PASO 1/2: COMPROBAR SIN CREAR ────────────────────────────────────
//
// Desde el 2026-10-30 «Nuevo cliente» tiene dos pantallas (frames `1868:15815`
// y `1868:16119`) y el cliente se crea al final, en la segunda. Pero lo que
// puede fallar de la primera —el nombre, la cédula, una cédula que ya es de
// alguien— tiene que decirse AL PULSAR «Continuar», no una pantalla después:
// enterarse en el paso 2 de que la cédula está repetida obliga a volver atrás
// sin saber a qué.
//
// Es la misma comprobación que `registrarCliente`, la MISMA función
// (`comprobarCliente`), y el alta la vuelve a hacer al guardar: entre una
// pantalla y otra puede haber entrado otro cliente con esa cédula.
export async function validarCliente(formData: FormData): Promise<ResultadoAlta> {
  const r = await comprobarCliente(formData);
  return r.ok ? { ok: true, clientId: "" } : r;
}

export async function registrarCliente(formData: FormData): Promise<ResultadoAlta> {
  const comprobado = await comprobarCliente(formData);
  if (!comprobado.ok) return comprobado;
  const { supabase, user, name, whatsapp, address, documentId, documentTypeRaw, documentCountry } =
    comprobado;

  // ── LA DEUDA SE LEE ANTES DE CREAR NADA ──────────────────────────────
  //
  // Una deuda mal escrita se rechaza con el cliente todavía sin crear: si se
  // validara después, el tendero se quedaría con un cliente guardado a medias y
  // al reintentar chocaría con su propia cédula.
  const leida = await leerDeudaAntigua(supabase, user.id, formData);
  if (!leida.ok) return { ok: false, error: leida.error };
  const deuda = leida.deuda;

  return crearCliente({ supabase, user, name, whatsapp, address, documentId, documentTypeRaw, documentCountry, deuda, formData });
}

type ClienteComprobado = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string };
  name: string;
  whatsapp: string;
  address: string;
  documentId: string;
  documentTypeRaw: string;
  documentCountry: string | null;
};

async function comprobarCliente(
  formData: FormData,
): Promise<ClienteComprobado | Extract<ResultadoAlta, { ok: false }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  // La cuenta pausada se para AQUÍ, antes de tocar nada. La política de la 061
  // también lo pararía, pero un insert rechazado vuelve como «new row violates
  // row-level security policy» y eso no se le enseña a nadie.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const name = String(formData.get("name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  // DÍGITOS, aunque el campo ya los filtre en pantalla: esa es una ayuda a
  // quien escribe, no una defensa del servidor. Mismo criterio que la regla de
  // las comprobaciones de propiedad explícitas — la capa de arriba no exime a
  // la de abajo.
  const documentId = String(formData.get("document_id") ?? "").replace(/[^0-9]/g, "");
  const documentTypeRaw = String(formData.get("document_type") ?? "").trim();

  if (!name) return { ok: false, error: "Escribe el nombre del cliente." };
  if (!documentId) return { ok: false, error: "Escribe la cédula del cliente." };

  // EL PAÍS DEL DOCUMENTO SE HEREDA DEL NEGOCIO y no se pregunta en el
  // formulario: qué país emitió la cédula de un cliente es un asunto de la
  // base, no algo que un tendero piense en mitad de una venta. Es lo mismo que
  // hace `createClientWithMovement`, y de aquí sale además qué letras valen.
  const { data: ownerRow } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();
  const documentCountry = (ownerRow?.country as string | undefined) ?? null;

  // ── DUPLICADOS: SE PARA, Y SE PUEDE CONFIRMAR ───────────────────────
  //
  // La mayoría de las veces el mismo documento bajo un dueño es un descuido —
  // un error de tecleo, o no recordar que esa persona ya está apuntada—. Pero
  // a veces es deliberado: un negocio informal sin registro propio se lleva
  // como una segunda cuenta de la misma persona («Pepito» y «Pepito negocio»).
  //
  // Así que se para la primera vez y se deja seguir si el tendero lo confirma,
  // igual que hace `createClientWithMovement` desde siempre.
  //
  // LO TUVE BLOQUEADO SIN SALIDA entre el 2026-10-18 y hoy mismo, razonando
  // que parar era correcto el 99 % de las veces. Lo era — y el 1 % restante se
  // quedaba sin forma de hacer lo que la otra puerta sí permitía, que es la
  // definición de dos puertas que se separan.
  const confirmado = formData.get("confirm_duplicate") === "true";
  // EL TIPO VIAJA CON EL NÚMERO desde el 2026-10-24: sin él, V-070707 y
  // J-070707 se leían como el mismo documento. Se manda ya validado contra el
  // país, igual que al guardar unas líneas más abajo.
  const tipoDelDocumento = isDocumentTypeFor(
    documentCountry as "VE" | "CO" | null,
    documentTypeRaw,
  )
    ? documentTypeRaw
    : null;
  const duplicado = await buscarDocumentoDuplicado(
    supabase,
    user.id,
    documentId,
    tipoDelDocumento,
  );
  if (duplicado && !confirmado) {
    return {
      ok: false as const,
      error: mensajeDeDuplicado(duplicado),
      duplicado: { id: duplicado.id, name: duplicado.name },
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
    name,
    whatsapp,
    address,
    documentId,
    documentTypeRaw,
    documentCountry,
  };
}

async function crearCliente({
  supabase,
  user,
  name,
  whatsapp,
  address,
  documentId,
  documentTypeRaw,
  documentCountry,
  deuda,
  formData,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string };
  name: string;
  whatsapp: string;
  address: string;
  documentId: string;
  documentTypeRaw: string;
  documentCountry: string | null;
  deuda: DeudaAntigua | null;
  formData: FormData;
}): Promise<ResultadoAlta> {
  const { data: nuevo, error } = await supabase
    .from("clients")
    .insert({
      owner_id: user.id,
      name,
      // `null`, nunca `""`: la cadena vacía se colaría como «sí hay número» en
      // el `.is("whatsapp", null)` con el que la importación decide si rellenar
      // el hueco, y ese cliente nunca volvería a recibir uno.
      whatsapp: whatsapp || null,
      address: address || null,
      document_id: documentId,
      // Migración 125. Un tipo que no corresponde al país se descarta en vez
      // de guardarse: un 'NIT' llegando de un negocio venezolano es un error o
      // una petición escrita a mano.
      document_type: isDocumentTypeFor(documentCountry as "VE" | "CO" | null, documentTypeRaw)
        ? documentTypeRaw
        : null,
      // Lo tecleó el tendero al registrar. Ver supabase/063.
      document_source: DOCUMENT_SOURCE.OWNER,
      document_country: documentCountry,
    })
    .select("id")
    .single();

  if (error || !nuevo) {
    return { ok: false, error: mensajeDeError("crear el cliente", error, "registrarCliente") };
  }

  // ── LA DEUDA ANTIGUA, COMO UN FIADO DE ESTE CLIENTE ──────────────────
  //
  // Una sola fila y la más nueva del libro, así que el disparador le pone su
  // `running_balance` bien sin recalcular nada (CLAUDE.md, «Quien escribe
  // varios movimientos de golpe, recalcula el saldo»: aquí es uno).
  if (deuda) {
    const { error: errorDeuda } = await supabase.from("movements").insert({
      client_id: nuevo.id,
      created_by: user.id,
      type: "charge",
      amount: deuda.amount,
      currency: deuda.sello.currency,
      description: deuda.description,
      source: "manual",
      photo_path: deuda.photoPath,
      plazo_dias: deuda.plazoDias,
      cuotas: deuda.cuotas,
      rate_mode_used: deuda.sello.rateModeUsed,
      exchange_rate_used: deuda.sello.exchangeRateUsed,
      official_bcv_rate_at_time: deuda.sello.officialBcvRateAtTime,
      entry_currency: deuda.sello.entryCurrency,
      entry_amount: deuda.sello.entryCurrency ? deuda.amount : null,
      rate_usd_at_time: deuda.sello.rateUsdAtTime,
      rate_eur_at_time: deuda.sello.rateEurAtTime,
    });
    if (errorDeuda) {
      // SIN LA DEUDA, EL CLIENTE TAMPOCO SE QUEDA. Se pidió como una sola cosa,
      // y un cliente creado a medias haría que el reintento chocara con su
      // propia cédula. Se borra con la clave de servicio porque el dueño no
      // puede borrar clientes (la papelera es un ocultado, migración `061`), y
      // con el dueño y el id explícitos: solo alcanza la ficha que esta misma
      // llamada acaba de crear.
      const { error: errorDeshacer } = await createServiceClient()
        .from("clients")
        .delete()
        .eq("id", nuevo.id)
        .eq("owner_id", user.id);
      if (errorDeshacer) {
        console.error("[registrarCliente] no se pudo deshacer el cliente:", errorDeshacer.message);
      }
      return {
        ok: false,
        error: mensajeDeError("guardar la deuda antigua", errorDeuda, "registrarCliente"),
      };
    }
  }

  // EN EL SERVIDOR Y NO EN EL NAVEGADOR, como todo lo que cuenta: en septiembre
  // de 2026 un dueño usó la app ocho de nueve días mientras Mixpanel lo daba
  // por perdido, porque los eventos salían de su iPhone y no llegaban.
  trackServer("Client Created", user.id, { client_id: nuevo.id }, user.email);

  // EL PERMISO DE WHATSAPP (MS-34). La casilla se enseña SIEMPRE en esta
  // pantalla, así que el cliente nace con `whatsapp_consent_asked_at` puesto y
  // el alta de movimiento ya no vuelve a preguntar.
  //
  // Lo que se guarda es el texto que pintó la casilla, generado por la MISMA
  // función: esa cadena es la evidencia ante Meta, y dos textos distintos la
  // convertirían en una reconstrucción.
  await guardarPermisoDeclarado(supabase, {
    clientId: nuevo.id,
    ownerId: user.id,
    clientName: name,
    source: "owner_movement_form",
    seMostro: formData.get(CONSENT_SHOWN_FIELD) != null,
    acepta: formData.get(CONSENT_FIELD) != null,
  });

  revalidatePath("/dashboard");
  revalidatePath("/clients");

  return { ok: true, clientId: nuevo.id };
}

// ===========================================================================
// ¿SEVENZ YA PUEDE ESCRIBIRLE A ESTE NÚMERO?
// ===========================================================================
//
// La pregunta que los formularios de alta tienen que hacer MIENTRAS el tendero
// teclea el teléfono, y que hasta el 2026-10-21 no hacía ninguno salvo el
// asistente de venta.
//
// POR QUÉ HACE FALTA: el permiso es del NÚMERO y no de la ficha, así que un
// teléfono que aceptó alguna vez acepta para toda ficha que lo lleve. Un
// tendero que deja la casilla sin marcar cree que no ha activado nada, y su
// cliente recibe el recibo igual. Lo reportó un dueño desde producción.
//
// VIVE AQUÍ, en las acciones del alta, porque los tres formularios que la
// necesitan ya importan `registrarCliente` de este mismo módulo: la pregunta
// y la escritura del alta son la misma conversación.
//
// SIN `clientId`, y ese es el punto: la ficha todavía no existe cuando el
// tendero está tecleando. `client_accepts_whatsapp` pide un id y por eso no
// sirve aquí.
export async function permisoDelNumero(
  whatsapp: string,
): Promise<{ granted: boolean; clientName: string | null }> {
  const vacio = { granted: false, clientName: null };
  // Un número a medio teclear no se pregunta: la función lo rechazaría igual
  // —normaliza a null por debajo de 10 dígitos— y esto ahorra una ida y
  // vuelta por cada tecla.
  if (whatsapp.replace(/\D/g, "").length < 10) return vacio;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return vacio;

  const { data, error } = await supabase.rpc("whatsapp_consent_for_phone", {
    p_phone: whatsapp,
  });

  // FALLA HACIA ENSEÑAR LA CASILLA. Si esta lectura no está disponible —a
  // mitad de un despliegue, o con la migración sin correr en este entorno— lo
  // peor que pasa es que se pregunte a alguien que ya aceptó, y eso se
  // deshace. Esconder la casilla por un error sería lo contrario: el tendero
  // creería que el permiso está dado cuando no se sabe.
  if (error) {
    console.error("[permisoDelNumero]", error.message);
    return vacio;
  }

  const r = data as { granted?: boolean; client_name?: string | null } | null;
  return { granted: r?.granted === true, clientName: r?.client_name ?? null };
}
