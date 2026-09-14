import type { MovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import type { LedgerCurrency } from "@/lib/types";

// Convierte lo que el dueño tecleó en bolívares al monto que se guarda.
//
// POR QUÉ. El cliente paga en bolívares y la deuda vive en dólares o en euros.
// Hasta ahora el dueño tenía que hacer esa división de cabeza —o salirse a la
// calculadora— para saber qué cifra teclear, y cualquier error en esa cuenta es
// dinero suyo.
//
// LO QUE NO CAMBIA: el libro sigue siendo en dólares o en euros. Los bolívares
// son una forma de ESCRIBIR el monto, nunca una tercera moneda donde se guarde
// una deuda. Si eso cambiara, `recalc_client_running_balance` tendría que
// agrupar por una moneda más y los saldos de todo el mundo se partirían en dos.
//
// Y queda constancia de las dos cifras: entry_amount guarda los bolívares que
// se tecleraron y entry_currency dice 'VES'. Esas columnas existen desde la 022,
// cuyo propio comentario dice que guardar lo que el dueño tecleó "es el
// respaldo más defendible en una disputa que una cifra derivada después". Se
// construyeron para esto.
export type MontoConvertido = {
  // Lo que se guarda en `amount`, en la moneda del libro.
  monto: number;
  // Lo que se guarda en `entry_amount`: los bolívares tal cual se escribieron.
  entryAmount: number;
  entryCurrency: "VES";
};

// Dos decimales, redondeo normal. Bs. 45.000 entre 832,4883 da 54,0487… y se
// guarda 54,05.
//
// Se descartó redondear "siempre a favor del dueño" —hacia abajo en un abono,
// hacia arriba en un fiado— porque la misma división daría resultados distintos
// según el tipo de movimiento, y eso es imposible de explicarle a un cliente
// que rehace la cuenta. El resumen del formulario muestra los céntimos antes de
// guardar, así que el dueño los ve y puede ajustar el monto si no le cuadran.
export function convertirDesdeBolivares(
  bolivares: number,
  destino: LedgerCurrency,
  snapshot: MovementRateSnapshot,
): MontoConvertido | { error: string } {
  const tasa = snapshot.ledger?.rate;
  const porUnidad = destino === "USD" ? tasa?.usd : tasa?.eur;

  // Sin tasa no hay conversión posible, y aquí no se puede seguir adelante como
  // en el resto del formulario: el monto ENTERO depende de ella. Un fiado en
  // dólares sin tasa se guarda bien porque la cifra la escribió el dueño; uno
  // tecleado en bolívares sin tasa no tiene ninguna cifra que guardar.
  if (!porUnidad || porUnidad <= 0) {
    return {
      error:
        "No pudimos consultar la tasa del BCV, así que no podemos pasar los bolívares a " +
        (destino === "USD" ? "dólares" : "euros") +
        ". Escribe el monto en " +
        (destino === "USD" ? "dólares" : "euros") +
        " o vuelve a intentarlo en un momento.",
    };
  }

  const monto = Math.round((bolivares / porUnidad) * 100) / 100;

  // Una cantidad de bolívares tan pequeña que no llega a un céntimo dejaría un
  // movimiento de cero, que no es un movimiento. Se rechaza en vez de guardarlo.
  if (monto <= 0) {
    return { error: "El monto es demasiado pequeño para registrarlo. Revisa la cifra." };
  }

  return { monto, entryAmount: bolivares, entryCurrency: "VES" };
}
