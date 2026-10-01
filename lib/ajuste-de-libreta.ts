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
  // Dónde va dentro de `reviewMovements`. JUSTO ANTES de la fila que lleva el
  // total escrito, no al final: el saldo corrido se comprueba EN esa fila, así
  // que un ajuste puesto después no cambiaría nada y el aviso seguiría en rojo
  // con el ajuste ya metido.
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
  libro: Pick<LibroDelCliente, "escrito" | "calculado" | "currency" | "filaDesajustada">;
  uid: string;
}): AjusteConstruido | null {
  const diferencia = (libro.escrito ?? 0) - (libro.calculado ?? 0);
  if (diferencia === 0 || !libro.filaDesajustada) return null;

  const suyas = movimientos.filter((m) => m.client_name === nombreDelCliente);
  const i = movimientos.findIndex((m) => m.uid === libro.filaDesajustada);
  const ancla = i >= 0 ? movimientos[i] : null;

  return {
    indice: i < 0 ? movimientos.length : i,
    movimiento: {
      client_name: nombreDelCliente,
      // HEREDA LA FECHA DE LA FILA A LA QUE SE ANCLA, no la de la subida.
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
      // Misma fecha que el ancla y no un día antes: la 076 añade un milisegundo
      // por cada movimiento EN EL ORDEN DEL PAYLOAD, y el ajuste va justo antes
      // de su ancla, así que con la misma fecha ya ordena delante.
      //
      // Si el ancla tampoco trae fecha, se queda en null y manda la de subida,
      // que es lo mismo que hacen sus hermanas.
      date: ancla?.date ?? null,
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
