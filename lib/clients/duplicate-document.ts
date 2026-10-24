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

// ===========================================================================
// EL PREFIJO CUENTA: V-070707 Y J-070707 NO SON EL MISMO DOCUMENTO
//
// Reportado por el dueño el 2026-10-24: registró un cliente con el mismo
// número cambiando la letra de V a J, y la app lo frenó como repetido.
//
// POR QUÉ PASABA, Y NO ERA UN DESCUIDO DE ESTA FUNCIÓN: el prefijo **no vive
// en `document_id`**. Las dos acciones que dan de alta un cliente filtran el
// campo a dígitos (`replace(/[^0-9]/g, "")`) y guardan la letra aparte, en
// `document_type` (migración `125`). Así que esto comparaba «070707» contra
// «070707» y acertaba — con la mitad del documento.
//
// EN CRISTIANO: en Venezuela, V-070707 es la cédula de una persona y J-070707
// el RIF de una empresa. Son dos documentos de dos sujetos distintos que solo
// comparten los números. Doña Rosa le vende a Julián y también a la bodega de
// Julián, y la app le decía que ya tenía apuntado al segundo.
export async function buscarDocumentoDuplicado(
  supabase: SupabaseClient,
  ownerId: string,
  documentId: string,
  // EL TIPO VA SIN VALOR POR DEFECTO A PROPÓSITO. Con uno, la puerta que no se
  // actualizara seguiría comparando media cédula y nadie se enteraría; sin él,
  // TypeScript obliga a tocar las dos. Es la regla de `CLAUDE.md` sobre un
  // campo nuevo entrando por todas las puertas de su acción, aplicada al revés:
  // aquí el que cambia es quien LEE, y el compilador señala a quien le escribe.
  //
  // Llega ya validado contra el país del negocio —`isDocumentTypeFor`— o
  // `null`: un 'NIT' de un negocio venezolano se descarta antes de llegar.
  documentType: string | null,
): Promise<ClienteDuplicado | null> {
  const normalizado = normalizeDocumentId(documentId);
  if (!normalizado) return null;
  const tipo = documentType?.trim() || null;

  const { data } = await supabase
    .from("clients")
    .select("id, name, document_id, document_type, trashed_at, deleted_at")
    .eq("owner_id", ownerId)
    .not("document_id", "is", null);

  const encontrado = data?.find((c) => {
    if (!c.document_id) return false;
    if (normalizeDocumentId(c.document_id as string) !== normalizado) return false;

    const suyo = ((c.document_type as string | null) ?? "").trim() || null;
    // ── CON LOS DOS TIPOS CONOCIDOS, LA LETRA DECIDE ──────────────────
    if (tipo && suyo) return tipo === suyo;

    // ── SI FALTA ALGUNO, SE AVISA IGUAL, Y ESA ASIMETRÍA ES DELIBERADA ─
    //
    // Hay fichas sin tipo: las de antes de la migración `125`, las importadas
    // de una libreta y aquellas cuyo tipo no correspondía al país y se
    // descartó. Comparando en estricto, una de esas nunca volvería a salir
    // como repetida y el MISMO cliente acabaría en dos fichas con la mitad de
    // lo que debe en cada una — que es exactamente lo que esta función existe
    // para impedir.
    //
    // LOS DOS ERRORES NO CUESTAN LO MISMO. Avisar de más es un cartel que el
    // tendero descarta con «Registrar a cuenta separada», porque esto nunca
    // fue un bloqueo: es una advertencia con salida. Avisar de menos parte a
    // una persona en dos y no se descubre hasta que alguien discute su cuenta.
    return true;
  });
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
