import type { DecisionDuplicado } from "@/lib/estado-de-tarjeta";
import type { ExtractedMovement } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// DESHACER, EN LA REVISIÓN ENTERA — CT-31
//
// Hasta el 2026-10-02 el único deshacer era el de la moneda: un solo nivel y
// solo para esa acción. Quitar un movimiento, renombrar a alguien, elegir un
// total o emparejar un cliente no se deshacían — y las cuatro cambian lo que se
// va a guardar en la deuda de una persona.
//
// ─────────────────────────────────────────────────────────────────────────
// QUÉ CUENTA COMO UN PASO, que es la decisión que define esto
//
// Hay dos formas de capturar y dan resultados muy distintos. Vigilar el estado
// con un efecto no se olvida nunca, pero mete un paso POR CADA TECLA al escribir
// una cédula: deshacer diez veces borraría diez letras en vez de la última
// decisión. Envolver cada acción a mano es preciso y es lo que se olvida en la
// siguiente que alguien añada.
//
// Se eligió lo segundo, con la lista escrita aquí para que quien añada una
// acción nueva la vea. Empujan al historial:
//
//   quitar y recuperar un movimiento · quitar y recuperar un cliente ·
//   editar un movimiento · aplicar moneda a la tanda · elegir el total ·
//   emparejar con un cliente existente · decir "es otra persona" ·
//   decir "es una cuenta separada" ante una cédula repetida ·
//   aceptar o quitar el saldo con el que arranca la libreta ·
//   asignar una línea suelta · renombrar a un cliente ·
//   marcar o desmarcar "todos el mismo cliente"
//
// NO empuja escribir en un campo de texto —cédula, WhatsApp, nombre
// compartido—: eso ya lo deshace el propio campo, y un historial que guarda
// cada pulsación deja de servir para lo que existe.
//
// ─────────────────────────────────────────────────────────────────────────
// VEINTE PASOS, Y NO MÁS POR UNA RAZÓN QUE NO ES LA MEMORIA
//
// Veinte copias de sesenta movimientos no le pesan a nadie. El límite es la
// previsibilidad: sin una lista visible de QUÉ se está deshaciendo, más allá de
// ahí el dueño ya no sabe a dónde vuelve, y un deshacer impredecible asusta más
// que no tenerlo.
export const MAX_PASOS = 20;

// Lo que se guarda y se restaura. `subidos` NO está, a propósito: un cliente ya
// escrito en la base no se des-sube desde esta pantalla, y ofrecer un botón que
// parece hacerlo sería mentir. Por eso `subirClientes` además VACÍA el historial
// (ver `import-flow`): deshacer hasta antes de una subida enseñaría una revisión
// que ya no se corresponde con lo que hay guardado.
export type Instantanea = {
  movimientos: ExtractedMovement[];
  eliminados: string[];
  clientesQuitados: Record<string, string[]>;
  decisiones: Record<string, DecisionDuplicado>;
  decisionesDeTotal: Record<string, unknown>;
  // CT-29b. Opcional porque una instantanea guardada antes de que esto
  // existiera no lo trae, y al restaurarla vale `{}` — o sea, la pregunta
  // vuelve. Preguntar de mas es el fallo barato; el caro es crear un duplicado
  // que nadie confirmo.
  documentoConfirmado?: Record<string, string>;
  // CT-12. Aceptar o quitar un saldo de apertura cambia lo que se va a escribir
  // en la deuda de alguien, asi que empuja al historial como cualquier otra.
  aperturas?: Record<string, { importe: number; fecha: string | null } | undefined>;
  sameClient: boolean;
  sharedName: string;
  sharedDocument: string;
  sharedWhatsapp: string;
  unlinked: string[];
};

// Apila, tirando lo más viejo cuando se pasa del tope. Devuelve un array nuevo:
// el estado de React no se muta, y una pila que se mutara in situ no provocaría
// el render que enciende el botón.
export function empujar(pasado: Instantanea[], ahora: Instantanea): Instantanea[] {
  const siguiente = [...pasado, ahora];
  return siguiente.length > MAX_PASOS ? siguiente.slice(siguiente.length - MAX_PASOS) : siguiente;
}

// Saca el último. Devuelve `null` en `instantanea` cuando no hay nada que
// deshacer, para que quien llama no tenga que comprobar la longitud además.
export function sacar(pasado: Instantanea[]): {
  pasado: Instantanea[];
  instantanea: Instantanea | null;
} {
  if (pasado.length === 0) return { pasado, instantanea: null };
  return { pasado: pasado.slice(0, -1), instantanea: pasado[pasado.length - 1] };
}

// Lo que dice el botón. Vive aquí y no en el componente porque los dos sitios
// donde sale —junto al título y junto a "Eliminar" en el detalle— tienen que
// decir lo mismo, y dos copias de una frase con un número dentro se separan.
export function textoDeDeshacer(pasos: number): string {
  if (pasos === 0) return "No hay nada que deshacer";
  return pasos === 1 ? "Deshacer el último cambio" : `Deshacer (${pasos} pasos atrás)`;
}
