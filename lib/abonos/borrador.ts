// EL REPARTO A MEDIAS, MIENTRAS EL TENDERO VA Y VUELVE.
//
// El flujo «1/2 fiados» sale de su pantalla para fijar a mano lo que le toca a
// un fiado —detalle 2/2 y monto— y vuelve con ese renglón puesto. Entre medias
// hay dos navegaciones, y el componente de 1/2 se desmonta en las dos.
//
// ===========================================================================
// POR QUÉ NO SE HACE COMO EL ASISTENTE DE VENTA
//
// `nueva-venta.tsx` lleva sus cuatro pasos DENTRO de un componente, con
// `useState`, y no navega. Es el patrón de la casa y sería lo primero que
// mirar — pero aquí no vale: el detalle 2/2 y la pantalla del monto ya existen
// como rutas, con sus consultas y sus reglas, y además son las MISMAS a las
// que se llega desde la ficha de un fiado (`?desde=detalle`). Volverlas a
// escribir como pasos dejaría dos copias del detalle de una transacción, que
// es justo lo que el dueño pidió evitar el 2026-10-22 al decir que los dos
// caminos llevan a la misma pantalla.
//
// ===========================================================================
// SESSIONSTORAGE, Y LO QUE SE PIERDE SI FALLA
//
// `CLAUDE.md` avisa de que iOS borra el almacenamiento del navegador sin
// pedir permiso, y la regla es que nada que importe dependa de que el
// navegador coopere. Esto cumple esa regla por lo que GUARDA, no por dónde:
// un borrador en vuelo, no un dato.
//
// Si se pierde, el tendero vuelve a escribir el monto. No se pierde dinero, no
// se pierde un movimiento, no queda nada a medias en la base — porque mientras
// esto vive, en la base no se ha escrito NADA: el reparto entero se guarda de
// una vez al pulsar «Pagar y finalizar».
//
// Lo que sí importa es que no reviva: un borrador de ayer, con fiados que ya
// se pagaron, enseñaría un reparto imposible sin decir por qué. De ahí la
// caducidad.

const CLAVE = "sevenz:reparto";

// Dos horas. Un reparto es una conversación de mostrador: se empieza y se
// termina con el cliente delante. Más allá de eso, lo que haya guardado es
// mucho más probable que sea basura de una sesión abandonada que algo que el
// tendero quiera recuperar.
const CADUCIDAD_MS = 2 * 60 * 60 * 1000;

export type BorradorDeReparto = {
  clienteId: string;
  libro: string | null;
  monto: string;
  enBolivares: boolean;
  // LO TECLEADO, YA EN LA MONEDA DEL LIBRO.
  //
  // Es `monto` convertido, así que es redundante — y se guarda igual. La
  // pantalla del monto lo necesita para saber cuánto queda del abono, y la
  // alternativa es que vuelva a convertir `monto` ella misma: la 1/2 usa
  // `priceIn` y la del monto usa `montoConvertido` con la tasa prevista o la
  // efectiva según una casilla distinta. Dos conversiones del mismo billete
  // que pueden dar dos cifras es exactamente el fallo que un tope existe para
  // evitar.
  //
  // Lo escribe SOLO la 1/2, que es la dueña de esta cifra; las demás leen.
  totalEnLibro: number;
  // movementId → lo que el tendero le fijó a mano, en el libro.
  aMano: Record<string, number>;
  guardadoEn: number;
};

export function guardarBorrador(b: Omit<BorradorDeReparto, "guardadoEn">): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${CLAVE}:${b.clienteId}`,
      JSON.stringify({ ...b, guardadoEn: Date.now() } satisfies BorradorDeReparto),
    );
  } catch {
    // Modo privado, almacenamiento lleno, permisos. No es un error que el
    // tendero deba ver: lo único que pierde es no tener que volver a teclear.
  }
}

export function leerBorrador(clienteId: string): BorradorDeReparto | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = window.sessionStorage.getItem(`${CLAVE}:${clienteId}`);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as BorradorDeReparto;
    if (b.clienteId !== clienteId) return null;
    if (!Number.isFinite(b.guardadoEn) || Date.now() - b.guardadoEn > CADUCIDAD_MS) {
      borrarBorrador(clienteId);
      return null;
    }
    // `aMano` viene de almacenamiento que cualquiera puede editar desde las
    // herramientas del navegador. Se sanea aquí y, sobre todo, el servidor
    // vuelve a topar cada línea contra lo que ese fiado debe: esto no es la
    // defensa, es la higiene.
    const aMano: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.aMano ?? {})) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) aMano[k] = v;
    }
    const totalEnLibro =
      typeof b.totalEnLibro === "number" && Number.isFinite(b.totalEnLibro) && b.totalEnLibro >= 0
        ? b.totalEnLibro
        : 0;
    return { ...b, aMano, totalEnLibro };
  } catch {
    return null;
  }
}

/** Fija lo que le toca a UN fiado y deja el resto del borrador como estaba. */
export function fijarEnBorrador(clienteId: string, movementId: string, monto: number): void {
  const b = leerBorrador(clienteId);
  if (!b) return;
  guardarBorrador({ ...b, aMano: { ...b.aMano, [movementId]: monto } });
}

export function borrarBorrador(clienteId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${CLAVE}:${clienteId}`);
  } catch {
    // Ídem.
  }
}
