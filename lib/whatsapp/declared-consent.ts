import type { SupabaseClient } from "@supabase/supabase-js";
import { textoPermisoDeclarado, type OrigenPermisoDeclarado } from "@/lib/whatsapp-opt-in";

// EL PERMISO QUE EL TENDERO DECLARA, ESCRITO DESDE LOS TRES SITIOS (MS-34).
//
// Lo llaman el alta de movimiento, el alta de cliente y la subida de libreta.
// Vive aquí y no dentro de cada acción porque las tres hacen exactamente lo
// mismo con él, y tres copias de una escritura de consentimiento es como
// acaban guardando cosas distintas — que en esta tabla no es un bug cualquiera
// sino una evidencia que deja de serlo.
//
// NO DEVUELVE ERROR, Y ES UNA DECISIÓN. El tendero vino a registrar un fiado o
// a subir su libreta; hacer fallar eso porque no se pudo anotar un permiso le
// quita lo que sí pidió para castigarle por lo que era un extra. Misma
// elección que `trashProduct` con sus notificaciones.
//
// La contrapartida, dicha en voz alta: si esto falla, el tendero cree que al
// cliente le van a llegar avisos y no le van a llegar, sin que nada lo diga.
// Se acepta porque hoy no sale ni un mensaje — `MS-3` sigue bloqueada — y
// porque la ficha del cliente (`MS-35`) va a enseñar el estado real, que es
// donde se notaría. El día que se envíe de verdad, esto merece revisarse.
export async function guardarPermisoDeclarado(
  supabase: SupabaseClient,
  {
    clientId,
    ownerId,
    clientName,
    source,
    seMostro,
    acepta,
  }: {
    clientId: string;
    ownerId: string;
    clientName: string;
    source: OrigenPermisoDeclarado;
    // Si la casilla llegó a estar en pantalla. Cuando no estuvo, esto no hace
    // NADA — y sobre todo no marca al cliente como preguntado, porque marcarlo
    // se comería la única oportunidad de preguntar por él.
    seMostro: boolean;
    acepta: boolean;
  },
): Promise<void> {
  if (!seMostro) return;

  // Se mostró. Preguntado queda, haya marcado o no: es justo lo que evita que
  // el modal salga en cada movimiento. Condicionado a que siga en null para no
  // escribir en `clients` en cada alta — a partir de la primera no toca nada.
  const { error: askedError } = await supabase
    .from("clients")
    .update({ whatsapp_consent_asked_at: new Date().toISOString() })
    .eq("id", clientId)
    .eq("owner_id", ownerId)
    .is("whatsapp_consent_asked_at", null);
  if (askedError) console.error("[guardarPermisoDeclarado] asked_at", askedError.message);

  if (!acepta) return;

  // El texto que se guarda es el MISMO que pintó la casilla, generado por la
  // misma función. Esa cadena es la evidencia ante Meta: dos textos distintos
  // la convertirían en una reconstrucción.
  //
  // `ownerId` sale de `auth.getUser()`, nunca del formulario, y desde la
  // migración 094 la función además exige que coincida con `auth.uid()`.
  const { data: guardado, error: consentError } = await supabase.rpc(
    "record_owner_declared_whatsapp_consent",
    {
      p_client_id: clientId,
      p_owner_id: ownerId,
      p_consent_text: textoPermisoDeclarado(clientName),
      p_source: source,
    },
  );

  if (consentError) console.error("[guardarPermisoDeclarado] rpc", consentError.message);
  else if (guardado !== true) {
    // `false` tiene causas reales y ninguna es un fallo técnico: el cliente no
    // es suyo, o no tiene número utilizable. Se registra para poder verlo.
    console.error("[guardarPermisoDeclarado] rechazado", { clientId, source });
  }
}
