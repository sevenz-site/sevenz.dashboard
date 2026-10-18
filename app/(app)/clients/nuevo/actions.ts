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

  // DUPLICADOS: aquí se BLOQUEA, sin «confírmalo y sigo».
  //
  // El diálogo de siempre deja confirmarlo porque un negocio informal a veces
  // lleva dos cuentas de la misma persona a propósito («Pepito» y «Pepito
  // negocio»), y ahí el tendero tiene el caso delante. Esta pantalla no ofrece
  // esa salida todavía: enseñar «ya existe» y parar es la respuesta correcta
  // el 99 % de las veces, y la que no pierde datos. Quien de verdad quiera la
  // segunda ficha la crea por la otra puerta.
  const duplicado = await buscarDocumentoDuplicado(supabase, user.id, documentId);
  if (duplicado) {
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
