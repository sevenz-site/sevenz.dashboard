// El mensaje con el que se comparte el saldo de un cliente.
//
// POR QUÉ VIVE APARTE. Lo mandan dos botones desde sitios distintos —
// "Compartir enlace" en el perfil del cliente y "Compartir" dentro de la ficha
// de un movimiento— y tienen que mandar EXACTAMENTE lo mismo. Escrito dos
// veces, el día que alguien retoque uno el cliente empieza a recibir dos
// mensajes distintos de la misma app según por dónde lo mandaran.
//
// Ya pasó una vez en este producto con la ficha del movimiento: dos copias
// escritas por su lado, una se quedó formateando en pesos. Ver detail-rows.tsx.
export function mensajeDeSaldo(clientName: string, balanceText: string, url: string): string {
  return `Hola ${clientName}, tu saldo actual es ${balanceText}. Puedes verlo aquí: ${url}`;
}

// De dónde sale el enlace, que no es lo mismo en las dos pantallas.
//
// El dueño no lo tiene a mano: hay que pedírselo al servidor, que lo crea la
// primera vez. El cliente sí lo tiene — es la dirección que está mirando— y
// además NO PODRÍA pedirlo: getOrCreateShareLink escribe en share_links y solo
// responde a un dueño con sesión.
//
// Es un tipo discriminado y no dos campos opcionales porque exactamente uno de
// los dos casos es cierto siempre, y con dos opcionales eso queda como una
// regla que hay que recordar en vez de una que el compilador comprueba.
export type OrigenDelEnlace =
  | { de: "dueño"; clientId: string }
  | { de: "cliente"; token: string };

export type DatosParaCompartir = {
  clientName: string;
  // El código de la transacción que se comparte. Va en el mensaje para que el
  // cliente pueda citarlo, y es lo que el tendero teclea en el buscador de
  // Inicio para volver a encontrarla. Nulo en una transacción anterior a los
  // códigos: el mensaje sale igual, sin esa mención.
  transactionCode: string | null;
  enlace: OrigenDelEnlace;
};

// EL MENSAJE CON EL QUE SE COMPARTE UNA TRANSACCIÓN, y no el saldo.
//
// Encargo del dueño el 2026-10-30, a partir de comentarios de usuarios: el
// «Compartir» de la ficha de una transacción mandaba el enlace al PERFIL del
// cliente, así que quien lo recibía aterrizaba en su saldo y tenía que buscar
// él la transacción de la que se hablaba. Ahora el enlace es el de esa
// transacción (`/s/<token>/t/<movimiento>`).
//
// POR ESO EL TEXTO CAMBIÓ TAMBIÉN. El de `mensajeDeSaldo` dice «tu saldo actual
// es …. Puedes verlo aquí», y con este enlace sería falso: la página que se abre
// enseña UNA transacción, no el saldo. `mensajeDeSaldo` se queda intacto para
// el botón de compartir del perfil del cliente, que sí manda al saldo.
export function mensajeDeTransaccion(
  clientName: string,
  transactionCode: string | null,
  url: string,
): string {
  const de = transactionCode ? `tu transacción ${transactionCode}` : "tu transacción";
  return `Hola ${clientName}, aquí está el detalle de ${de}: ${url}`;
}
