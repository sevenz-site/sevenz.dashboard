import type { ExtractedMovement, LedgerCurrency, MovementType } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// LA LIBRETA ARRANCA CON UNA DEUDA QUE SEVENZ NO TIENE — CT-12
//
// Medido el 2026-09-21 con la libreta de Mariangel Mendoza: 23 renglones, los
// 23 en rojo, y los 23 desfasados en LA MISMA cantidad — 99 exactos. La libreta
// y Sevenz coincidían en todos los movimientos; lo único que faltaba era el
// saldo con el que esa página empezaba, escrito en su primera línea como
// «Hasta la fecha 99».
//
// La consecuencia no era cosmética: el resumen de confirmación cerraba en
// −$79,50 donde la libreta cerraba en +$19,50. Confirmar habría registrado que
// el negocio le debía a la clienta.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ PASA, Y POR QUÉ ES DETECTABLE
//
// `reconcileMovements` ya sabe deducir el saldo de arranque de una página: lo
// despeja del primer total escrito. Pero lo tiene apagado para los clientes
// NUEVOS, a propósito y con buen criterio — su comentario dice «la certeza
// viene de no existir, no de deber cero».
//
// Ese criterio vale para un cliente cuya libreta empieza en su primera página.
// Falla cuando la foto es de la página 7 de un cuaderno viejo, que es el caso
// normal. Y entonces el saldo corrido se calcula desde 0 mientras la libreta lo
// lleva desde 99, así que CADA fila sale desfasada en 99.
//
// Que las 23 difieran en lo mismo no es una pista: es la aritmética. Por eso se
// puede deducir con certeza qué falta — y por eso NO se aplica solo.
//
// ─────────────────────────────────────────────────────────────────────────
// LAS DOS FILAS SON EL LÍMITE, Y NO ES UN NÚMERO ELEGIDO AL AZAR
//
// Con UNA sola fila comprobable, un desfase de 20 es indistinguible de un monto
// mal leído. Y los montos mal leídos existen y están medidos: CT-13 documenta
// la misma foto devolviendo 20 tres veces y 15 una, las cuatro marcadas como
// lectura segura.
//
// Con DOS o más, un error en medio se delata solo: desfasa las filas que vienen
// DESPUÉS y deja cuadrando las de antes, así que los desfases dejan de ser
// iguales y esto no dispara. Es justo lo que separa «falta el saldo anterior»
// de «hay un monto mal leído».
//
// LO QUE NO SEPARA, y hay que saberlo: un monto mal leído en la PRIMERA fila
// desfasa todas por igual, exactamente como un saldo de apertura. Esos dos
// casos no se distinguen con lógica. Lo único que los separa es que quien tiene
// la foto delante mire — y por eso la pantalla enseña la cifra propuesta JUNTO
// al primer apunte de la página, no sola.
const IGUALDAD = 0.01;

// Por debajo de esto, `reconcileMovements` ya considera que la fila cuadra, así
// que proponer un saldo de apertura sería proponer ruido.
const MINIMO = 1;

export const DESCRIPCION_DE_APERTURA = "Saldo anterior";

export type AperturaDetectada = {
  // Positivo: la página arranca con el cliente debiendo. Negativo: con el
  // negocio debiéndole a él — un adelanto, una devolución. Raro, pero existe, y
  // sin admitirlo esas libretas se quedan sin arreglo y en rojo entero.
  importe: number;
  // Cuántas filas sostienen la deducción. Se enseña: «las 23 líneas difieren en
  // lo mismo» es el argumento, y un número lo hace comprobable de un vistazo.
  filas: number;
};

type FilaParaDetectar = Pick<
  ReviewRow,
  "read_balance" | "page_balance" | "defines_base" | "amount" | "type" | "description"
>;

// El desfase constante de un libro, o `null` si no lo hay.
//
// Recibe las filas de UN cliente en UNA moneda. Dos libros del mismo cliente
// son dos cadenas independientes y cada uno puede arrancar donde quiera.
export function detectarApertura(filas: FilaParaDetectar[]): AperturaDetectada | null {
  // Si alguna fila se gastó en deducir la base, el cliente ya existía en Sevenz
  // y su saldo de arranque ya salió de ahí. No hay nada que proponer.
  if (filas.some((f) => f.defines_base)) return null;

  const comprobables = filas.filter((f) => f.read_balance !== null);
  if (comprobables.length < 2) return null;

  const desfases = comprobables.map((f) => (f.read_balance as number) - f.page_balance);
  const primero = desfases[0];
  if (Math.abs(primero) < MINIMO) return null;
  if (desfases.some((d) => Math.abs(d - primero) > IGUALDAD)) return null;

  return { importe: primero, filas: comprobables.length };
}

// El primer apunte de la página, para poder enseñarlo AL LADO de la cifra
// propuesta. Es la única defensa contra el caso que la lógica no separa — un
// monto mal leído en la primera fila — así que la pantalla que no lo enseñe no
// debería ofrecer esto.
export function primerApunte(
  filas: FilaParaDetectar[],
): { descripcion: string | null; importe: number; tipo: MovementType } | null {
  const f = filas[0];
  if (!f) return null;
  return { descripcion: f.description, importe: f.amount, tipo: f.type };
}

export type AperturaConstruida = {
  movimiento: ExtractedMovement;
  // Dónde entra en la lista: DELANTE del primer renglón de ese libro.
  //
  // Al revés que la línea de ajuste de CT-27, que va al final. No es una
  // inconsistencia: el ajuste cuadra el CIERRE y por eso va detrás de todo; la
  // apertura es el saldo con el que la página EMPIEZA, así que tiene que entrar
  // en el saldo corrido antes que nada o no corrige ninguna fila.
  indice: number;
};

// La línea que el dueño aceptó, hecha movimiento.
//
// `importe` y `fecha` vienen de la decisión guardada, no se recalculan. Es la
// diferencia con el ajuste, que SÍ es derivado: el ajuste es una función de los
// renglones de esta página —si uno cambia, el ajuste tiene que cambiar—, pero
// la apertura es un hecho sobre la página ANTERIOR. Corregir un monto de hoy no
// cambia lo que esa persona debía antes de empezar.
export function construirApertura({
  movimientos,
  nombreDelCliente,
  currency,
  importe,
  fecha,
  uid,
}: {
  movimientos: ExtractedMovement[];
  nombreDelCliente: string;
  currency: LedgerCurrency | null;
  importe: number;
  fecha: string | null;
  uid: string;
}): AperturaConstruida | null {
  if (!Number.isFinite(importe) || Math.abs(importe) < MINIMO) return null;

  const esSuya = (m: ExtractedMovement) =>
    (m.client_name ?? "").trim().toLowerCase() === nombreDelCliente.trim().toLowerCase() &&
    (m.currency ?? null) === currency;

  const indice = movimientos.findIndex(esSuya);
  if (indice < 0) return null;

  // HEREDA LA CÉDULA Y EL TELÉFONO de sus hermanas, igual que el ajuste: son
  // datos de la PERSONA, no del renglón. Naciendo en null, la fila recién
  // creada bloquearía la subida por «falta la cédula» mientras la tarjeta dice
  // que todo está completo.
  const hermana = movimientos.find(esSuya);

  return {
    indice,
    movimiento: {
      client_name: hermana?.client_name ?? nombreDelCliente,
      date: fecha,
      // Un importe negativo es el negocio debiéndole al cliente: entra como
      // abono, no como un cargo con el signo cambiado. `amount` es siempre
      // positivo en esta tabla y el signo lo pone `type`.
      type: importe > 0 ? "charge" : "payment",
      amount: Math.abs(importe),
      description: DESCRIPCION_DE_APERTURA,
      read_balance: null,
      confidence: "high",
      document_id: hermana?.document_id ?? null,
      whatsapp: hermana?.whatsapp ?? null,
      currency,
      uid,
    },
  };
}

// La fecha con la que nace la propuesta: la del PRIMER apunte de la página.
//
// Decisión del usuario del 2026-10-02, y editable. Es más honesta con la mora
// que la fecha de subida: esa deuda es anterior a la página, no de hoy, y
// fecharla hoy haría que una deuda de ocho meses pareciera nueva — justo lo que
// la migración 076 se construyó para evitar. Sigue siendo una aproximación,
// porque la libreta no dice cuándo nació; por eso se puede cambiar.
export function fechaDeApertura(
  movimientos: ExtractedMovement[],
  nombreDelCliente: string,
  currency: LedgerCurrency | null,
): string | null {
  const clave = nombreDelCliente.trim().toLowerCase();
  const suya = movimientos.find(
    (m) =>
      (m.client_name ?? "").trim().toLowerCase() === clave && (m.currency ?? null) === currency,
  );
  return suya?.date ?? null;
}
