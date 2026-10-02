// ─────────────────────────────────────────────────────────────────────────
// NINGÚN ERROR LLEGA AL DUEÑO EN IDIOMA DE PROGRAMADOR
//
// Regla del usuario, 2026-10-01: "todos los errores deben ser comprensibles a
// quien no sepa de programación".
//
// Lo que había era al revés. Veintitrés sitios escribían
// `No pudimos guardar los cambios: ${error.message}`, y ese `message` es el de
// Postgres: "new row violates row-level security policy for table movements",
// "duplicate key value violates unique constraint
// clients_owner_id_document_id_key". Y `/api/extract` devolvía el `message` de
// cualquier excepción, así que el día que el servidor se quedó sin salida a
// internet la pantalla del dueño dijo, literalmente, **"fetch failed"**. Visto
// en dev el 2026-10-01.
//
// EL DEFECTO SE INVIERTE, Y ESA ES TODA LA IDEA. Antes salía todo salvo lo que
// alguien se acordara de tapar; ahora no sale nada salvo lo que esté escrito
// aquí para que salga. Un error nuevo —de una librería que todavía no
// existe, de un código de Postgres que nunca hemos visto— cae en el mensaje
// genérico en vez de aparecer en inglés delante de un bodeguero.
//
// EL DETALLE DE VERDAD NO SE PIERDE: se escribe con `console.error` desde aquí
// dentro, no en cada sitio que llama, porque lo que se delega a veintitrés
// sitios se olvida en alguno. En producción eso va a los logs de Vercel, que es
// donde hace falta para depurar.

// Nuestras propias excepciones, ya escritas para el dueño.
//
// Se MARCAN en vez de adivinarse por el texto. Mirar el string para decidir si
// un mensaje es nuestro es la misma trampa que el `confidence` del modelo: te da
// una respuesta siempre y no es una medida de nada. Con una clase, o es nuestro
// o no lo es, y no hay tercera opción.
export class ErrorParaElDueno extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorParaElDueno";
  }
}

// Lo que se dice cuando no sabemos qué pasó. Dice tres cosas, y las tres hacen
// falta: que no se guardó (para que no se quede con la duda), que puede
// reintentar, y que hay a quién escribirle si insiste. "Error desconocido" no
// cumple ninguna.
const GENERICO = "Inténtalo otra vez. Si vuelve a pasar, escríbenos y lo miramos.";

type ErrorConCodigo = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

function comoErrorDeBase(error: unknown): ErrorConCodigo | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as ErrorConCodigo;
  if (typeof e.message !== "string" && typeof e.code !== "string") return null;
  return e;
}

// Un fallo de red: la petición no llegó a tener respuesta. En Node, `fetch`
// lanza `TypeError: fetch failed`; el motivo real viene en `cause` y ahí es
// donde aparecen ECONNREFUSED, ENOTFOUND y compañía. Ninguno de esos nombres
// significa nada para quien no programa, pero la situación sí se puede contar.
function esFalloDeRed(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const texto = error instanceof Error ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}` : String(error);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(texto);
}

// Los códigos de Postgres que un dueño puede provocar de verdad usando la app,
// cada uno con lo que significa EN SU MUNDO, no en el del motor.
//
// Deliberadamente corto. Un mapa largo de códigos que nadie ha visto nunca da
// la sensación de estar cubierto sin estarlo; lo que cubre de verdad es que
// todo lo que no esté aquí cae en el genérico, que también es legible.
function porCodigo(e: ErrorConCodigo): string | null {
  const texto = `${e.message ?? ""} ${e.details ?? ""}`;

  switch (e.code) {
    case "23505":
      // Clave repetida. La única que un dueño encuentra de verdad es la cédula:
      // dos clientes con el mismo documento.
      if (/document_id/.test(texto)) {
        return "Ya tienes otro cliente con esa cédula. Revísala, o busca al cliente que ya la tiene.";
      }
      return "Ese dato ya está registrado.";
    case "23503":
      // Clave foránea: se apunta a algo que ya no está.
      return "Ese cliente ya no existe. Puede que lo hayas borrado desde otro teléfono.";
    case "23502":
      return "Falta un dato obligatorio.";
    case "23514":
      return "Alguno de los datos no es válido.";
    case "42501":
      // Permisos. Para el dueño esto no es "insufficient privilege": es que ese
      // dato no lo cambia él. Lo dice igual que `profile/actions.ts`, que ya
      // tenía este caso resuelto a mano desde la migración 055.
      return "Ese dato solo lo puede cambiar Sevenz. Escríbenos y lo ajustamos.";
    case "PGRST301":
      return "Tu sesión caducó. Vuelve a entrar y repítelo.";
    default:
      return null;
  }
}

// Los errores de Storage no traen código: vienen con el mensaje en inglés del
// servicio. Se reconocen por lo poco que puede fallar al subir una foto.
function porMensajeDeStorage(e: ErrorConCodigo): string | null {
  const texto = e.message ?? "";
  if (/maximum allowed size|payload too large|too large/i.test(texto)) {
    return "La foto pesa demasiado. Haz una más pequeña o recórtala.";
  }
  if (/mime type|not supported|invalid file/i.test(texto)) {
    return "Ese tipo de archivo no se puede subir. Usa una foto JPG o PNG.";
  }
  if (/not found|does not exist/i.test(texto)) {
    return "Ese archivo ya no está.";
  }
  return null;
}

// EL ÚNICO SITIO POR EL QUE SALE UN ERROR HACIA EL DUEÑO.
//
// `accion` es lo que estaba intentando hacer, en infinitivo y en sus palabras:
// "guardar los cambios", "mover el cliente a la papelera". La frase se arma con
// eso, así que el dueño lee qué no pasó antes de leer qué hacer.
//
// `contexto` solo va al log, para encontrarlo entre otros: el nombre de la
// acción del servidor, por ejemplo.
export function mensajeDeError(accion: string, error: unknown, contexto?: string): string {
  // El detalle real, siempre, y antes de decidir nada: si algo de aquí abajo
  // fallara, el log ya estaría escrito.
  console.error(`[${contexto ?? accion}]`, error);

  // Lo nuestro pasa tal cual: ya está escrito para él.
  if (error instanceof ErrorParaElDueno) return error.message;

  if (esFalloDeRed(error)) {
    return `No pudimos ${accion} porque se cortó la conexión. Comprueba tu internet e inténtalo otra vez.`;
  }

  const e = comoErrorDeBase(error);
  if (e) {
    const porQue = porCodigo(e) ?? porMensajeDeStorage(e);
    if (porQue) return `No pudimos ${accion}. ${porQue}`;
  }

  return `No pudimos ${accion}. ${GENERICO}`;
}
