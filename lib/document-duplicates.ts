import { normalizeDocumentId } from "@/lib/format";
import type { CandidatoDuplicado, ReconcileClient } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// LA OTRA MITAD DE CT-29: LA CÉDULA — y por qué no bastaba con el nombre
//
// `CT-29a` resolvió el emparejamiento por NOMBRE: un renglón que dice "Karina
// castillo" encuentra a *(kari)* y a *(negocio lomas)*, los enseña, y la dueña
// elige. Pero el nombre no es lo único por lo que dos fichas son la misma
// persona, y tampoco es lo que la dueña teclea: teclea la CÉDULA.
//
// El callejón que esto cierra, medido el 2026-10-02: ella mira sus dos Karinas,
// decide «no, esta es otra, la del kiosco», escribe la cédula… y resulta ser la
// misma, porque es la misma persona con dos cuentas — que es JUSTO el caso que
// la migración `034` protege al tirar el índice único. Hasta hoy el servidor la
// rechazaba. Le habíamos puesto la pregunta y no la salida.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ ES UNA LISTA APARTE Y NO SE MEZCLA CON LA DEL NOMBRE
//
// Dos preguntas distintas, y la diferencia importa para cuándo caducan:
//
//   por nombre    se dispara con lo que trae la FOTO, y no cambia mientras la
//                 revisión está abierta.
//   por documento se dispara con lo que la dueña ESCRIBE, y cambia cada vez
//                 que corrige un dígito.
//
// Mezcladas, una decisión tomada contra las dos Karinas seguiría valiendo
// después de cambiar la cédula por la de Petra — y Petra entraría duplicada sin
// que nadie la viera. Separadas, la respuesta a esta se guarda junto al
// documento con el que se respondió (ver `decisionesDeDocumento` en
// `import-flow`), así que corregir un dígito vuelve a preguntar solo. Sin
// lógica de invalidación que mantener: se cura sola.
//
// ─────────────────────────────────────────────────────────────────────────
// SE RESTA LO QUE YA SE ENSEÑÓ, O SON DOS AVISOS DICIENDO LO MISMO
//
// En el caso corriente los dos candidatos SON los mismos clientes: la dueña
// acaba de ver las dos fichas de Karina y ha dicho que no. Preguntárselo otra
// vez en un segundo recuadro ámbar, con las mismas dos personas, es ruido — y
// peor: enseña que el sistema no se enteró de lo que acaba de responder.
//
// Así que lo que esta función devuelve es SOLO lo que no se ha enseñado todavía
// por nombre. Con las dos Karinas devuelve vacío; si teclea la cédula de Petra,
// devuelve a Petra, que es exactamente a quien hay que preguntar por.

export type DocumentDuplicateRow = {
  client_name: string;
  document_id: string | null;
  // Cuando apunta a un cliente que ya existe NO se está creando a nadie, así
  // que no hay choque posible: el servidor solo comprueba el documento en la
  // rama de cliente nuevo. Una tarjeta ya emparejada no pregunta nada.
  matched_client_id: string | null;
};

// Los clientes que ya tienen el documento que esta tarjeta trae escrito, menos
// los que su aviso de nombre ya está enseñando. Clave: el `nameKey` de siempre
// —`trim().toLowerCase()` del nombre—, para que encaje con `candidatos`,
// `decisiones` y todo lo demás sin un segundo índice que mantener.
export function findDocumentDuplicates(
  rows: DocumentDuplicateRow[],
  clients: ReconcileClient[],
  nameCandidates: Map<string, CandidatoDuplicado[]>,
): Map<string, CandidatoDuplicado[]> {
  // Por documento normalizado, y a LISTA, no a uno.
  //
  // El `Map` del servidor guarda un solo cliente por documento, así que con dos
  // fichas de la misma cédula gana la última del bucle y la otra es invisible.
  // Aquí la pregunta es "¿de cuál de estas es?", y para eso hacen falta todas:
  // enseñar una sola sería volver a elegir por la dueña, que es el fallo que
  // `CT-22` arregló para los nombres.
  const byDocument = new Map<string, ReconcileClient[]>();
  for (const c of clients) {
    if (!c.document_id) continue;
    const key = normalizeDocumentId(c.document_id);
    if (!key) continue;
    const ya = byDocument.get(key);
    if (ya) ya.push(c);
    else byDocument.set(key, [c]);
  }

  const resultado = new Map<string, CandidatoDuplicado[]>();
  for (const row of rows) {
    if (row.matched_client_id) continue;
    const nameKey = row.client_name.trim().toLowerCase();
    if (!nameKey || resultado.has(nameKey)) continue;
    const escrito = row.document_id?.trim();
    if (!escrito) continue;

    const choques = byDocument.get(normalizeDocumentId(escrito));
    if (!choques?.length) continue;

    const yaEnseñados = new Set((nameCandidates.get(nameKey) ?? []).map((c) => c.id));
    const nuevos = choques.filter((c) => !yaEnseñados.has(c.id));
    if (nuevos.length === 0) continue;

    resultado.set(
      nameKey,
      nuevos.map((c) => ({
        id: c.id,
        name: c.name,
        document_id: c.document_id,
        whatsapp: c.whatsapp,
        balance: c.balance,
        balance_usd: c.balance_usd,
        balance_eur: c.balance_eur,
        hidden: c.hidden ?? null,
      })),
    );
  }
  return resultado;
}

// El documento con el que se respondió, para poder comparar después. Vive aquí
// —y no suelto en el componente— porque la comparación tiene que usar la MISMA
// normalización que la detección: si una compara "V-18.356.808" y la otra
// "18356808", la respuesta deja de valer en cuanto se guarda y la pregunta sale
// en bucle.
export function documentAnswerKey(documentId: string | null | undefined): string {
  return normalizeDocumentId(documentId?.trim() ?? "");
}
