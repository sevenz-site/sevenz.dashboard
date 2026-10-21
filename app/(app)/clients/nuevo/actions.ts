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

// UN CLIENTE, Y NADA MÁS. Frame `1389:8313`, encargo del dueño del 2026-10-18.
//
// ===========================================================================
// ESTO NO EXISTÍA, Y ES EL CAMBIO DE FONDO DE LA PANTALLA
//
// Hasta hoy la única forma de crear un cliente era `createClientWithMovement`:
// nacía **con su primer fiado**, con monto, plazo y cuotas. Tenía sentido
// mientras Sevenz fuera un libro de deudas — un cliente sin deuda no era nada.
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

export async function registrarCliente(formData: FormData): Promise<ResultadoAlta> {
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
  const duplicado = await buscarDocumentoDuplicado(supabase, user.id, documentId);
  if (duplicado && !confirmado) {
    return {
      ok: false,
      error: mensajeDeDuplicado(duplicado),
      duplicado: { id: duplicado.id, name: duplicado.name },
    };
  }

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
