import { porGravedad, type FiadoOrdenable } from "@/lib/estado-del-plazo";

// CÓMO SE REPARTE UN ABONO ENTRE VARIOS FIADOS.
//
// Encargo del dueño el 2026-10-22, preguntado en claro antes de construirlo:
// *«Sevenz asigna los otros 10 restantes al siguiente abono disponible por
// gravedad de estado o entre varios por gravedad de estado»*.
//
// O sea: el tendero escribe cuánto le pagaron, y el dinero cae solo por el
// fiado más grave primero hasta agotarse. Lo que él ajuste a mano se respeta
// y el resto se recalcula con lo que queda — así, cambiar una cifra no obliga
// a teclear todas las demás.
//
// ===========================================================================
// POR QUÉ ES UNA FUNCIÓN PURA Y NO ESTADO DENTRO DE LA PANTALLA
//
// Porque es la parte que se puede equivocar en silencio. Un reparto que suma
// mal, o que deja dinero sin asignar, o que le mete a un fiado más de lo que
// debe, no rompe nada visible: se guarda, la pantalla dice que todo bien, y la
// diferencia la descubre el tendero semanas después cuando la app le
// contradice lo que recuerda haber acordado con su cliente.
//
// Separada, se prueba con números y sin navegador. Dentro de un componente,
// solo se prueba haciendo clics.
//
// ===========================================================================
// UNA SOLA MONEDA, Y AQUÍ NO SE COMPRUEBA
//
// Decisión del dueño del mismo día: un reparto no mezcla monedas. Quien llama
// pasa ya solo los fiados del libro elegido, y la migración `137` lo vuelve a
// exigir al escribir. Esta función no vuelve a mirarlo porque no sabría qué
// hacer con la respuesta: no tiene pantalla donde decirlo.

const HOLGURA = 0.005;

export type FiadoParaRepartir = FiadoOrdenable & {
  movementId: string;
};

export type LineaDelReparto = {
  movementId: string;
  // Lo que le toca a este fiado. Cero es una línea que NO se guarda: la
  // pantalla le dibuja su botón «Pagar» en vez de un importe.
  asignado: number;
  // Si ese importe lo puso el tendero a mano. Las de a mano no se recalculan
  // cuando cambia el monto; las automáticas sí.
  aMano: boolean;
};

export type Reparto = {
  lineas: LineaDelReparto[];
  // Lo que no cupo en ningún fiado. Solo puede ser > 0 si el monto supera lo
  // que el cliente debe en esa moneda, y la pantalla lo impide antes; se
  // devuelve igual para que quien llame no tenga que deducirlo.
  sinAsignar: number;
  // La suma de lo asignado. Es lo que de verdad se va a guardar.
  repartido: number;
};

/**
 * Reparte `monto` entre `fiados`, respetando lo puesto a mano.
 *
 * `aMano` es un mapa de movementId → importe fijado por el tendero. Lo que
 * está ahí se respeta tal cual (topado a lo que ese fiado debe); el resto del
 * dinero cae por gravedad sobre los demás.
 *
 * `ahora` entra como argumento: el orden tiene que salir del mismo instante
 * que los rótulos que la pantalla pinta al lado, o la lista puede ordenarse de
 * una forma y rotularse de otra sin que nada falle.
 */
export function repartir({
  monto,
  fiados,
  aMano = {},
  ahora = new Date(),
}: {
  monto: number;
  fiados: FiadoParaRepartir[];
  aMano?: Record<string, number>;
  ahora?: Date;
}): Reparto {
  const porOrden = [...fiados].sort(porGravedad(ahora));

  const lineas = new Map<string, LineaDelReparto>();
  let queda = Math.max(0, monto);

  // PRIMERO LO FIJADO A MANO: su decisión manda sobre el automático, y hasta
  // que no se descuenta no se sabe cuánto queda para los demás.
  for (const f of porOrden) {
    const puesto = aMano[f.movementId];
    if (puesto == null) continue;
    const v = redondear(Math.max(0, Math.min(puesto, f.pendiente)));
    lineas.set(f.movementId, { movementId: f.movementId, asignado: v, aMano: true });
    queda = redondear(queda - v);
  }

  // Y EL RESTO BAJA POR GRAVEDAD HASTA AGOTARSE.
  for (const f of porOrden) {
    if (lineas.has(f.movementId)) continue;
    if (queda <= HOLGURA) {
      lineas.set(f.movementId, { movementId: f.movementId, asignado: 0, aMano: false });
      continue;
    }
    const v = redondear(Math.min(f.pendiente, queda));
    lineas.set(f.movementId, { movementId: f.movementId, asignado: v, aMano: false });
    queda = redondear(queda - v);
  }

  // SE DEVUELVEN EN EL ORDEN DE GRAVEDAD, no en el que llegaron: es el que la
  // pantalla dibuja, y el que explica por qué al primero le tocó todo.
  const enOrden = porOrden.map((f) => lineas.get(f.movementId)!);
  const repartido = redondear(enOrden.reduce((s, l) => s + l.asignado, 0));

  return {
    lineas: enOrden,
    sinAsignar: redondear(Math.max(0, monto) - repartido),
    repartido,
  };
}

/**
 * Lo que el cliente debe en este libro: el tope del monto que se puede teclear.
 *
 * Decisión del dueño del 2026-10-21: *«El abono no puede exceder el saldo
 * total de lo que ese cliente debe»*.
 */
export function deudaDelLibro(fiados: FiadoParaRepartir[]): number {
  return redondear(fiados.reduce((s, f) => s + f.pendiente, 0));
}

// Al céntimo, y en cada paso y no solo al final: sin esto, restar 0,1 tres
// veces de 60 deja 59,699999999999996 arrastrándose por todo el reparto y la
// última línea sale con una cifra que nadie escribió.
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
