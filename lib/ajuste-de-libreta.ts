import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";
import type { LibroDelCliente } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// LA LÍNEA DE AJUSTE, Y EL BORRADO CON VUELTA ATRÁS
//
// Las dos cosas vivían dentro de `import-flow.tsx`, enredadas con `setState`.
// Se sacaron aquí el 2026-09-30 para poder probarlas desde Node: las dos
// deciden sobre la deuda de una persona y ninguna tenía prueba.

// La descripción la LEE EL CLIENTE en su página pública: `description` es el
// único campo del movimiento que `get_shared_balance` devuelve (migración 043).
// Por eso dice la verdad en sus términos, no en los nuestros.
export const DESCRIPCION_DEL_AJUSTE = "Ajuste al subir la libreta";

export type AjusteConstruido = {
  movimiento: ExtractedMovement;
  // Dónde va dentro de la lista: AL FINAL, detrás de todos los renglones.
  //
  // Hasta el 2026-10-01 iba justo antes de la primera fila que descuadraba, para
  // que esa fila pasara a dar el total de la libreta y su aviso rojo se apagara.
  // Decisión del usuario, CT-27: va al final.
  //
  // Lo que se gana es que la cifra final sea SIEMPRE la que el dueño escribió a
  // mano. Anclar en el primer descuadre solo acierta cuando el error es un
  // desfase constante; con el error en medio, el cierre quedaba en otro número
  // (60 donde la libreta decía 50, en el mockup M).
  //
  // Lo que se paga, y hay que saberlo: los avisos rojos de las filas de en medio
  // NO se apagan. Siguen diciendo que ahí la cuenta se separó, que es verdad —
  // lo que el ajuste arregla es el cierre, no el renglón. Un ajuste al final no
  // puede cambiar un saldo corrido que se comprueba antes de él.
  indice: number;
};

// Construye la línea que cuadra la página con el total que el dueño dijo que
// era el bueno. Null cuando no hay nada que cuadrar.
//
// HEREDA LA CÉDULA Y EL TELÉFONO de sus hermanas: son datos de la PERSONA, no
// del renglón. Naciendo en null, un dueño que escribiera la cédula y DESPUÉS
// eligiera "mi libreta" se encontraba el botón de subir bloqueado por una fila
// recién creada — y la tarjeta diciendo "Todo cuadra". Visto en dev el
// 2026-09-29.
export function construirAjuste({
  movimientos,
  nombreDelCliente,
  libro,
  uid,
}: {
  movimientos: ExtractedMovement[];
  nombreDelCliente: string;
  libro: Pick<LibroDelCliente, "escrito" | "calculado" | "currency" | "filaDelTotal">;
  uid: string;
}): AjusteConstruido | null {
  const diferencia = (libro.escrito ?? 0) - (libro.calculado ?? 0);
  if (diferencia === 0 || !libro.filaDelTotal) return null;

  const suyas = movimientos.filter((m) => m.client_name === nombreDelCliente);
  // La fecha sale del ÚLTIMO renglón de esta persona EN ESTA MONEDA, porque el
  // ajuste va detrás de él. Dos libros del mismo cliente son dos cadenas
  // distintas: heredar la fecha del último renglón en euros para un ajuste en
  // dólares lo colocaría en el sitio equivocado de la cadena de dólares.
  const deEsaMoneda = suyas.filter((m) => (m.currency ?? null) === (libro.currency ?? null));
  // Si ninguna fila lleva esa moneda —no debería pasar, los libros se derivan de
  // las propias filas— vale cualquier renglón suyo antes que ninguno: quedarse
  // en `date: null` haría que la 076 le pusiera la fecha de HOY, que es
  // exactamente el fallo que se arregló el 2026-10-01. Una fecha algo movida es
  // recuperable; un cargo fechado hoy en la cadena de una deuda vieja, no.
  const candidatos = deEsaMoneda.length ? deEsaMoneda : suyas;
  const ultimo = candidatos.length ? candidatos[candidatos.length - 1] : null;

  return {
    indice: movimientos.length,
    movimiento: {
      client_name: nombreDelCliente,
      // HEREDA LA FECHA DEL ÚLTIMO RENGLÓN DE SU LIBRO, no la de la subida.
      //
      // Con `date: null` la migración 076 le ponía la fecha de HOY, así que el
      // ajuste se colocaba el último de la cadena por mucho que en la revisión
      // fuera el primero. Medido en dev el 2026-10-01 subiendo la libreta de
      // Mariangel: en pantalla iba delante y los saldos eran 99 → 102,50 →
      // 110,50 → 90,50; en la base quedó detrás y la cadena pasó a ser 3,50 →
      // 11,50 → -8,50 → 90,50.
      //
      // Dos cosas se rompían con eso. La clienta ve en su enlace que durante
      // tres semanas el negocio le debía 8,50 y que hoy le metieron un cargo de
      // 99 de golpe — nada de eso pasó. Y la mora sale de esa misma cadena
      // (`get_oldest_unpaid_charge`), así que el cargo figuraba como de hoy en
      // vez de desde cuando empezó la deuda.
      //
      // Misma fecha que el último renglón y no un día después: la 076 añade un
      // milisegundo por cada movimiento EN EL ORDEN DEL PAYLOAD, y desde CT-27
      // el ajuste va el último, así que con la misma fecha ya ordena detrás.
      // Ponerle un día más lo sacaría del periodo que cubre la página.
      //
      // Si ese renglón tampoco trae fecha, se queda en null y manda la de
      // subida, que es lo mismo que hacen sus hermanas.
      date: ultimo?.date ?? null,
      type: diferencia > 0 ? "charge" : "payment",
      amount: Math.abs(diferencia),
      description: DESCRIPCION_DEL_AJUSTE,
      read_balance: null,
      confidence: "high",
      document_id: suyas.find((m) => m.document_id?.trim())?.document_id ?? null,
      whatsapp: suyas.find((m) => m.whatsapp?.trim())?.whatsapp ?? null,
      uid,
      currency: libro.currency as LedgerCurrency | null,
    },
  };
}

// ── Quitar y recuperar ──────────────────────────────────────────────────
//
// Quitar un movimiento NO lo borra del array: lo marca. La fila se queda en su
// sitio, en rojo, con un botón de recuperar, hasta que se sube la libreta. Un
// toast que dura cinco segundos obliga a reaccionar a tiempo; así el dueño
// puede quitar un renglón, seguir revisando veinte clientes y recuperarlo.

export type EstadoDeQuitados = {
  // Los `uid` que ahora mismo no cuentan para nada: ni saldos, ni sumas, ni
  // resumen.
  eliminados: Set<string>;
  // Por cliente quitado, los renglones que se llevó POR DELANTE esa
  // eliminación — no todos los suyos.
  porCliente: Record<string, string[]>;
};

export function quitarMovimiento(estado: EstadoDeQuitados, rowId: string): EstadoDeQuitados {
  return { ...estado, eliminados: new Set(estado.eliminados).add(rowId) };
}

export function recuperarMovimiento(estado: EstadoDeQuitados, rowId: string): EstadoDeQuitados {
  const eliminados = new Set(estado.eliminados);
  eliminados.delete(rowId);
  return { ...estado, eliminados };
}

// Quitar a una persona entera. Se apunta QUÉ renglones se llevó ESTA
// eliminación, no solo que el cliente se fue.
export function quitarCliente(
  estado: EstadoDeQuitados,
  nameKey: string,
  rowIds: string[],
): EstadoDeQuitados {
  const nuevos = rowIds.filter((id) => !estado.eliminados.has(id));
  const eliminados = new Set(estado.eliminados);
  for (const id of nuevos) eliminados.add(id);
  return { eliminados, porCliente: { ...estado.porCliente, [nameKey]: nuevos } };
}

// RECUPERAR AL CLIENTE NO RESUCITA LO QUE EL DUEÑO YA HABÍA QUITADO.
//
// Si antes había quitado un movimiento suelto suyo, ese NO vuelve: lo quitó a
// propósito, y devolvérselo sería deshacer una decisión que nadie pidió
// deshacer. Por eso se guardan los renglones de cada eliminación y no basta con
// "todos los de este cliente".
export function recuperarCliente(estado: EstadoDeQuitados, nameKey: string): EstadoDeQuitados {
  const suyos = estado.porCliente[nameKey] ?? [];
  const eliminados = new Set(estado.eliminados);
  for (const id of suyos) eliminados.delete(id);
  return {
    eliminados,
    porCliente: Object.fromEntries(
      Object.entries(estado.porCliente).filter(([k]) => k !== nameKey),
    ),
  };
}
