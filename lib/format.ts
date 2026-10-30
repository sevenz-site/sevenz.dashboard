// Always shows both decimals — amounts are numeric(12,2) in the database, and
// rounding a displayed figure while summing the exact stored values elsewhere
// (e.g. dashboard totals) can make line items look like they don't add up.
const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}

// «30 de agosto de 2026», the date as the history cards draw it -- frames
// `1861:15468`, `1861:15490` and `1861:15513` (owner's request of
// 2026-10-30). The detail screens keep the short `formatDate`.
export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// ===========================================================================
// LA FECHA DE UN RECIBO, EN LA ZONA DEL NEGOCIO
//
// `formatDate` y `formatDateTime` no fijan zona, así que usan la de quien las
// ejecuta. Eso vale en una pantalla del tendero --su propio teléfono-- y es
// FALSO en los dos sitios donde se pone una fecha en un recibo:
//
//   · UN COMPONENTE DE SERVIDOR corre en Vercel, que va en UTC. Un abono de
//     las nueve de la noche en Caracas saldría fechado al día siguiente.
//   · EL RECIBO DEL CARRITO lo dibuja el teléfono del CLIENTE, que puede estar
//     en otro país. La fecha de una compra es la del negocio, no la de quien
//     mira el papel.
//
// Es la misma regla que el detalle de un pedido ya tenía escrita desde el
// 2026-10-13 --*«The owner's zone, never the server's»*-- y vive aquí para
// que haya UNA implementación: aquella estaba suelta dentro de su página, que
// es como acaban existiendo dos relojes.
//
// SE DEDUCE DEL PAÍS Y NO SE GUARDA, porque Sevenz opera en dos y cada uno
// tiene una sola zona. El día que haya un tercero con varias, esto deja de
// valer y la zona pasa a ser un campo de `owners`.
export function zonaDelNegocio(country: string | null | undefined): string {
  return country === "VE" ? "America/Caracas" : "America/Bogota";
}

/**
 * Fecha y hora de un recibo, en la zona del negocio.
 *
 * CON HORA, y no solo la fecha: un tendero puede recibir dos abonos del mismo
 * cliente el mismo día --pasa en el fixture de dev, tres el 20 de octubre-- y
 * dos recibos con la misma línea no se distinguen. Un recibo existe para
 * zanjar «¿me pagaste o no?», y sin hora no zanja ese caso.
 */
export function formatReceiptDateTime(iso: string, country: string | null | undefined): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: zonaDelNegocio(country),
  }).format(new Date(iso));
}

// null covers both payments (no term applies) and charges left "sin
// especificar" — both render the same way, as "not applicable".
export function formatPlazoDias(days: number | null): string {
  return days == null ? "—" : `${days} días`;
}

// HOW OFTEN A CUOTA FALLS DUE, in days. Cuotas SPLIT the term, they do not
// extend it: 3 cuotas over 30 days is one every 10 (the owner's decision and
// his own example, 2026-10-16).
//
// ONLY THE FORM SAYS IT NOW. It was shared with the movement's card until
// 2026-10-16, when the owner asked the card for the DATES instead -- see
// `lib/cuotas.ts`, which computes them from the same rule. This one stays
// because the form has no dates to show: nothing has been saved yet, so the
// interval is the only thing that can be promised.
//
// NO ROUNDING, on purpose: 4 cuotas over 30 days is 7,5 days, which is exactly
// what migration `118` computes with `plazo * (cubiertas + 1) / n`. Rounding to
// 7 here would print a deadline the database never uses -- and the owner would
// have no way to tell which of the two was lying.
export function formatCadaCuantosDias(plazoDias: number, cuotas: number): string {
  const cada = plazoDias / cuotas;
  const legible = Number.isInteger(cada) ? String(cada) : cada.toFixed(1).replace(".", ",");
  return `${legible} ${legible === "1" ? "día" : "días"}`;
}

// Cédula-style grouping (23.845.083) — only applied to purely numeric
// documents; a document with letters (e.g. a foreigner ID prefix) is shown
// exactly as stored rather than guessed at.
// EL DOCUMENTO, COMO SE LEE EN LA CÉDULA: «V-32.256.369».
//
// Encargo del dueño el 2026-10-24: *«En todos los lugares donde se maquete el
// documento del cliente debe incluir el prefijo»*.
//
// ===========================================================================
// POR QUÉ EL TIPO ES OBLIGATORIO Y NO TIENE VALOR POR DEFECTO
//
// Esto se dibuja en DOCE sitios. Con un valor por defecto, cualquiera que no
// se actualizara seguiría enseñando media cédula y nadie se enteraría: no es
// un error, es un dato correcto al que le falta un trozo. Sin él, TypeScript
// señala las doce puertas de una vez. Es la misma razón por la que
// `buscarDocumentoDuplicado` tampoco lo tiene.
//
// ===========================================================================
// `null` NO INVENTA UNA LETRA, Y ESO ES LO CORRECTO
//
// Hay fichas sin tipo y seguirá habiéndolas: las anteriores a la migración
// `125`, las importadas de una libreta, aquellas cuyo tipo no correspondía al
// país y se descartó al guardar, y los pedidos del catálogo —`catalog_orders`
// no tiene columna de tipo, porque el formulario público nunca lo pregunta—.
// Ahí se enseña el número a secas, como hasta hoy.
//
// Poner una «V» por defecto sería peor que no poner nada: en Venezuela V y J
// distinguen a una persona de una empresa, así que adivinarla es afirmar algo
// que nadie tecleó sobre la identidad de alguien.
//
// Sirve para los dos países sin saber cuál es: 'V'/'E'/'J' y 'CC'/'CE'/'NIT'
// se anteponen igual, y la lista de qué vale en cada sitio ya la guarda
// `lib/document-id.ts`.
export function formatDocumentId(
  documentId: string | null,
  documentType: string | null,
): string {
  if (!documentId) return "—";
  const prefijo = documentType?.trim() ? `${documentType.trim()}-` : "";
  // UN DOCUMENTO QUE NO ES SOLO DÍGITOS SE DEVUELVE TAL CUAL —hay fichas
  // antiguas con letras dentro— pero SÍ lleva su prefijo si lo tiene: lo que
  // no se toca es el formato del número, no la identidad de quien lo porta.
  if (!/^\d+$/.test(documentId)) return `${prefijo}${documentId}`;
  return `${prefijo}${documentId.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

// Strips punctuation/spacing so "555.111.222" and "555 111 222" compare equal
// to "555111222" — older records were stored exactly as typed with no fixed
// format, so duplicate detection has to normalize before comparing.
//
// The document field only accepts digits since 2026-09-17, so new records need
// no normalising at all. This still matters for the ones stored before that.
export function normalizeDocumentId(documentId: string): string {
  return documentId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
