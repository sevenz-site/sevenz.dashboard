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
  // El saldo de HOY del cliente entero, no el de este movimiento. El mensaje
  // dice "tu saldo actual", y el saldo que arrastra un movimiento es el que
  // había justo después de él — que en un cliente con movimientos posteriores
  // ya no es el actual.
  balanceText: string;
  enlace: OrigenDelEnlace;
};
