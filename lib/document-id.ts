// What a client's document field can hold.
//
// THE STORED VALUE IS DIGITS. Nothing else — no prefix, no dots, no letters.
// An earlier version stored "V-12345678" for Venezuelan records and it was
// dropped on 2026-09-17, before it ever reached production, because the prefix
// carried no information: every Venezuelan record got the same letter, the
// country already lives in `clients.document_country` since migration 035, and
// normalizeDocumentId had to strip the letter again to compare two records. It
// was written only to be ignored, and it broke duplicate detection on the way.
//
// ===========================================================================
// THE LETTER CAME BACK ON 2026-10-18, AND IT IS NOT THE SAME LETTER
//
// The owner asked for the type to be CHOSEN — V, E or J — with the new-client
// screen (frame `1389:8313`). That removes the premise of the paragraph above:
// the letter is no longer the same on every record, and the three choices are
// three different kinds of holder. A J- is a company; an E- is a foreigner.
// That is a real fact about who owes the money.
//
// WHAT DID NOT CHANGE IS WHERE IT LIVES. The type is its own column
// (`clients.document_type`, migration 125) and `document_id` is still digits,
// precisely so that duplicate detection keeps working: migration 033's unique
// index normalises while KEEPING letters, so "V-12345678" and "12345678" would
// be two different keys and the same client could be registered twice without
// a single error. The old decision's second half still holds; only its first
// half stopped applying.
//
// Kept in its own module, away from the component, so the rules can be tested
// without a browser: a .tsx file cannot be imported by a plain Node script.

export type ParsedDocumentId = { digits: string; legacy: boolean };

// Splits a stored value into what the digits box should show.
//
// Punctuation is not a defect: "12.345.678" is a real document someone typed
// with dots, and it shows as its digits. Of the 158 documents in production,
// 154 are already bare digits and 4 are something else.
//
// `legacy` is only for a value with LETTERS in it — "pendiente" from a
// shopkeeper filling the form to get past it, or a foreign "E-12345678". Those
// are never rewritten. Showing an "E-12345678" in a digits box would drop the
// E the next time anyone saved the form, and that is losing a real fact about
// a person because someone opened a dialog.
export function parseDocumentId(stored: string): ParsedDocumentId {
  const value = (stored ?? "").trim();
  if (value === "") return { digits: "", legacy: false };
  if (/[a-z]/i.test(value)) return { digits: "", legacy: true };

  const digits = value.replace(/\D/g, "");
  if (digits === "") return { digits: "", legacy: true };
  return { digits, legacy: false };
}


// ── EL TIPO DE DOCUMENTO ───────────────────────────────────────────────
//
// LAS LETRAS SON LAS QUE VIENEN IMPRESAS EN EL DOCUMENTO, y por eso se guardan
// tal cual en vez de un enum inventado tipo 'natural' / 'foreign' / 'company':
// lo que el tendero elige en el selector es literalmente lo que queda escrito,
// y un valor guardado en la base sobrevive al código que lo escribió
// (`CLAUDE.md`). Un enum traducido obligaría a una tabla de equivalencias en
// cada pantalla que lo enseñe.
export type DocumentType =
  | "V"
  | "E"
  | "J"
  | "CC"
  | "CE"
  | "NIT"
  // COLOMBIA GANÓ CUATRO EL 2026-10-26, por encargo del dueño: *«creémoslo
  // con las opciones CC, CE, TI, PAS, PEP y PPT»*. Son los documentos con los
  // que se identifica de verdad quien compra allí: el menor de edad lleva TI,
  // el turista o el recién llegado el pasaporte, y PEP y PPT son los permisos
  // con los que está regularizada la migración venezolana —que en una bodega
  // colombiana no es un caso raro, es media clientela de algunos barrios—.
  | "TI"
  | "PAS"
  | "PEP"
  | "PPT";

// QUÉ SIGNIFICA CADA UNA, para el desplegable. El tendero no elige entre
// letras sueltas: elige entre «una persona», «alguien de fuera» y «una
// empresa», y la letra es la forma corta de eso.
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  V: "Venezolano",
  E: "Extranjero",
  J: "Jurídico (empresa)",
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  NIT: "NIT (empresa)",
  TI: "Tarjeta de identidad",
  PAS: "Pasaporte",
  PEP: "Permiso Especial de Permanencia",
  PPT: "Permiso por Protección Temporal",
};

// LOS TRES JUEGOS SON PARALELOS: persona del país, persona de fuera, empresa.
// Colombia tiene su propio trío y lleva el suyo por decisión del dueño del
// 2026-10-18 — enseñarle «V» a un tendero colombiano guardaría una letra que
// no está en la cédula que tiene delante.
//
// EL PRIMERO DE CADA LISTA ES EL QUE VIENE PUESTO. No hay una constante aparte
// para el valor por defecto a propósito: dos sitios que digan cuál es el
// primero acaban discrepando, y aquí el orden ya lo dice.
const POR_PAIS: Record<"VE" | "CO", DocumentType[]> = {
  VE: ["V", "E", "J"],
  // LOS SEIS QUE PIDIÓ EL DUEÑO el 2026-10-26, en su orden, MÁS `NIT` al
  // final. `CC` sigue primero, así que lo que viene puesto no cambia.
  //
  // `NIT` SALIÓ Y VOLVIÓ EL MISMO DÍA. Su lista no lo nombraba, así que se
  // quitó del desplegable; al decírselo --que un negocio colombiano se
  // quedaba sin forma de marcar a una empresa-- contestó *«Agrega NIT al
  // desplegable colombiano»*. Va el ÚLTIMO y no tercero como antes: los seis
  // de arriba son documentos de personas y los pide cualquier cliente;
  // facturarle a una empresa es lo raro, y el orden de una lista es lo que
  // dice qué se espera encontrar primero.
  CO: ["CC", "CE", "TI", "PAS", "PEP", "PPT", "NIT"],
};

// ── LO QUE SE ACEPTA SIN ESTAR EN EL DESPLEGABLE ──────────────────────
//
// Hoy está vacío, y se queda escrito porque la distinción vale: una cosa es
// qué se OFRECE al teclear una ficha nueva y otra qué se ADMITE al guardar
// una que ya existe.
//
// Si una letra sale del desplegable y a la vez deja de admitirse, la primera
// vez que alguien abra y guarde una ficha vieja marcada con ella, el servidor
// la descartará y la guardará sin tipo. Sin error y sin aviso. `NIT` estuvo
// aquí unas horas el 2026-10-26, entre que salió del desplegable y el dueño
// pidió devolverlo; si alguna otra sale algún día, este es su sitio.
const EXTRAS_ACEPTADOS: Record<"VE" | "CO", DocumentType[]> = {
  VE: [],
  CO: [],
};

// LOS TIPOS QUE UN NEGOCIO DE ESTE PAÍS PUEDE ELEGIR.
//
// País desconocido devuelve lista vacía, y eso NO es un descuido: sin saber el
// país no se sabe qué juego de letras corresponde, y elegir uno a ciegas
// guardaría «V» en la cédula de un colombiano. Es la misma regla que
// `resolveMovementRateSnapshot` aplica a la moneda — se rechaza antes que
// suponer. Quien reciba una lista vacía enseña la caja sin selector, que es lo
// que había hasta hoy y nunca guardó un dato falso.
export function documentTypesFor(country: "VE" | "CO" | null | undefined): DocumentType[] {
  return country ? POR_PAIS[country] : [];
}

// EL TIPO QUE VIENE PUESTO AL ABRIR EL FORMULARIO. «por defecto estará
// seleccionado siempre V» — el dueño, 2026-10-18; en Colombia, su equivalente.
export function defaultDocumentType(country: "VE" | "CO" | null | undefined): DocumentType | null {
  return documentTypesFor(country)[0] ?? null;
}

// SI UN TIPO VALE PARA UN PAÍS. Lo usa el servidor: el navegador manda el tipo
// en el formulario, y un 'NIT' llegando desde un negocio venezolano es o un
// error o una petición escrita a mano. En los dos casos se descarta en vez de
// guardarse.
export function isDocumentTypeFor(
  country: "VE" | "CO" | null | undefined,
  type: string | null | undefined,
): type is DocumentType {
  if (!type) return false;
  if (!country) return false;
  return (
    documentTypesFor(country).includes(type as DocumentType) ||
    EXTRAS_ACEPTADOS[country].includes(type as DocumentType)
  );
}
