import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDocumentId } from "@/lib/format";

// ¿YA EXISTE UN CLIENTE DE ESTE DUEÑO CON ESTE DOCUMENTO?
//
// ===========================================================================
// POR QUÉ ESTO VIVE EN `lib/` Y NO DENTRO DE LA ACCIÓN QUE LO USABA
//
// Lo usaban una acción y ahora lo usan dos: el alta de cliente con su primer
// movimiento (`createClientWithMovement`) y la pantalla de cliente nuevo del
// 2026-10-18. Copiarlo habría sido la forma exacta de que las dos puertas se
// separen — y lo que se escapa por la que se quede atrás es **el mismo cliente
// registrado dos veces**, con la mitad de lo que debe en cada ficha.
//
// ===========================================================================
// SE COMPARA NORMALIZADO, Y ESO NO ES COSMÉTICA
//
// `document_id` se guarda tal cual se teclea, sin formato fijo: "12.345.678" y
// "12345678" son la misma persona. `normalizeDocumentId` es la misma función
// que usa el índice único de la migración `033`, así que lo que esto deja
// pasar es exactamente lo que la base deja pasar — dos reglas distintas serían
// un aviso que no salta y un error de base que sí.
//
// ===========================================================================
// LOS OCULTOS CUENTAN, A PROPÓSITO
//
// Dejarlos fuera permitiría recrear a alguien que se ocultó y empezar su
// historial de cero, que es justo lo que conservar la identidad (decisión D1)
// existe para impedir, y dejaría a una persona partida en dos fichas.
export type ClienteDuplicado = {
  id: string;
  name: string;
  // En la papelera o escondido. Cambia el consejo que se le da al tendero:
  // restaurar, no volver a crear.
  oculto: boolean;
};

export async function buscarDocumentoDuplicado(
  supabase: SupabaseClient,
  ownerId: string,
  documentId: string,
): Promise<ClienteDuplicado | null> {
  const normalizado = normalizeDocumentId(documentId);
  if (!normalizado) return null;

  const { data } = await supabase
    .from("clients")
    .select("id, name, document_id, trashed_at, deleted_at")
    .eq("owner_id", ownerId)
    .not("document_id", "is", null);

  const encontrado = data?.find(
    (c) => c.document_id && normalizeDocumentId(c.document_id as string) === normalizado,
  );
  if (!encontrado) return null;

  return {
    id: encontrado.id as string,
    name: encontrado.name as string,
    oculto: Boolean(encontrado.trashed_at || encontrado.deleted_at),
  };
}

// LA FRASE QUE LEE EL TENDERO, aquí y no en cada pantalla, por la misma razón
// que la búsqueda: dos avisos distintos para el mismo hecho se contradicen el
// día que uno de los dos cambie.
export function mensajeDeDuplicado(duplicado: ClienteDuplicado): string {
  return duplicado.oculto
    ? `${duplicado.name} ya tiene esta cédula y está en la papelera. Restáuralo desde Papelera en vez de crearlo otra vez.`
    : `Ya existe un cliente con esta cédula: ${duplicado.name}`;
}
