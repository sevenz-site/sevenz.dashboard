import { porGravedad, type FiadoOrdenable } from "@/lib/estado-del-plazo";
import type { LedgerCurrency } from "@/lib/types";

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
  //
  // PERO NO POR ENCIMA DEL MONTO. Decisión del dueño del 2026-10-22,
  // preguntada en claro: manda lo tecleado. El campo «¿Cuánto abona?» es el
  // billete que el cliente puso en el mostrador, y la suma de las líneas no
  // puede pasarse de él.
  //
  // Sin este tope, tecleando $1 y fijando $7 a mano la pantalla 1/2 enseñaba
  // dos cifras contradictorias --el campo «1», el botón «Pagar y finalizar
  // $7.00»-- y se guardaban 7. En Venezuela, además, el servidor convierte LO
  // TECLEADO a bolívares y lo reparte entre líneas que sumaban otra cosa, así
  // que la equivalencia guardada no correspondía a lo cobrado.
  //
  // Va AQUÍ y no solo en la pantalla porque `aMano` llega del navegador: es
  // el mismo motivo por el que el reparto se recalcula en el servidor en vez
  // de aceptar las líneas ya repartidas.
  //
  // Se recorta en orden de gravedad, así que cuando dos líneas a mano no caben
  // juntas, la que sobrevive entera es la del fiado más grave.
  for (const f of porOrden) {
    const puesto = aMano[f.movementId];
    if (puesto == null) continue;
    const v = redondear(Math.max(0, Math.min(puesto, f.pendiente, queda)));
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

// ═══════════════════════════════════════════════════════════════════════════
// EL REPARTO QUE CRUZA LIBROS
//
// Encargo del dueño el 2026-10-23, preguntado en claro al diseñar la opción
// única de «Bolívares»: *«A los fiados más críticos sin importar moneda, es
// decir, en algunos casos los fiados más críticos pueden ser en dólares, en
// otros casos en euros y en otros casos mixtos»*.
//
// DESPLAZA LA DECISIÓN DEL 2026-10-22 —«un reparto no mezcla monedas»— y las
// dos quedan escritas. La razón de aquella no cubre este caso: aquella era
// sobre pagar un fiado en dólares CON euros, que exige una tasa euro/dólar
// que nadie acordó. Aquí lo que el cliente pone en el mostrador son
// BOLÍVARES, y los bolívares se convierten a cada libro por la tasa del día.
// Son dos conversiones independientes del mismo billete, no una entre libros.
//
// ===========================================================================
// POR QUÉ ES UNA FUNCIÓN APARTE Y NO UN MODO DE `repartir`
//
// `repartir` no sabe de monedas a propósito: su cabecera lo dice y
// `qa:reparto` tiene veinte filas escritas contra esa simplicidad. Meterle un
// segundo modo habría puesto una rama de conversión dentro de la aritmética
// que ya está probada, y esas veinte filas habrían pasado a cubrir la mitad
// de lo que cubren.
//
// Lo que sí comparten es el ORDEN: las dos ordenan con `porGravedad`, que es
// la única definición de «el más crítico» que tiene este producto.
//
// ===========================================================================
// LA GRAVEDAD SE MIDE EN BOLÍVARES, Y ESO NO ES UN DETALLE
//
// El billete está en bolívares, así que lo que se va gastando se cuenta en
// bolívares. Cada fiado consume el mínimo entre lo que le queda por pagar
// —convertido a bolívares— y lo que queda del billete. Lo que se GUARDA es esa
// cifra devuelta a la moneda del fiado, porque es ahí donde vive su deuda.
//
// Y SE TOPA OTRA VEZ A `pendiente` DESPUÉS DE CONVERTIR: la ida y vuelta puede
// devolver 5,8401 donde el fiado debe 5,84, y la migración `141` rechaza el
// reparto ENTERO si una línea se pasa. Medio céntimo de tolerancia tiene la
// base; esta función no se apoya en ella.
//
// ===========================================================================
// LOS BORDES, ENUMERADOS ANTES DE ESCRIBIRLO
//
//   * UN FIADO CUYA MONEDA NO TIENE TASA: no se puede convertir, así que
//     recibe 0 y se queda fuera. Mejor fuera que dentro con una cifra
//     inventada — es la misma regla que la pantalla aplica a la equivalencia.
//   * UN NEGOCIO COLOMBIANO: no tiene bolívares, así que nunca llega aquí. La
//     pantalla no le ofrece la opción.
//   * TODOS LOS FIADOS EN UN SOLO LIBRO, que es el caso corriente: el
//     resultado es el mismo que daría `repartir` sobre ese libro, salvo por
//     el redondeo de la ida y vuelta.
//   * LO FIJADO A MANO viene en la moneda de SU fiado, no en bolívares: es lo
//     que el tendero tecleó en la pantalla de ese fiado. Se descuenta del
//     billete convirtiéndolo, igual que todo lo demás.
//   * MÁS DINERO QUE DEUDA: sobra, y sale en `sinAsignarBs`. La pantalla lo
//     impide antes; se devuelve para que quien llame no tenga que deducirlo.
export type FiadoParaRepartirMulti = FiadoParaRepartir & {
  // null es el libro colombiano. Aquí no debería llegar nunca —ver los
  // bordes— y se admite en el tipo porque es el tipo que tiene el resto del
  // producto; falsearlo aquí solo movería el problema de sitio.
  currency: LedgerCurrency | null;
};

export type LineaDelRepartoMulti = LineaDelReparto & {
  currency: LedgerCurrency | null;
  // Lo mismo que `asignado`, en bolívares. Se devuelve calculado y no se
  // recalcula fuera: dos conversiones del mismo billete que pueden dar dos
  // cifras distintas es el fallo que un tope existe para evitar.
  asignadoBs: number;
};

export type RepartoMulti = {
  lineas: LineaDelRepartoMulti[];
  sinAsignarBs: number;
  repartidoBs: number;
};

export function repartirEnBolivares({
  montoBs,
  fiados,
  aMano = {},
  ahora = new Date(),
  aBolivares,
  desdeBolivares,
}: {
  montoBs: number;
  fiados: FiadoParaRepartirMulti[];
  // movementId → importe fijado a mano, EN LA MONEDA DE SU FIADO.
  aMano?: Record<string, number>;
  ahora?: Date;
  // LAS CONVERSIONES ENTRAN COMO FUNCIONES y no como un objeto de tasas. Dos
  // razones, y la segunda es la que manda: así esta función no tiene que
  // conocer la forma de `BolivarRates` ni de dónde salió la tasa —la del día,
  // la prevista, la sellada—, y así se prueba con números inventados sin
  // montar un contexto de tasas entero.
  //
  // `null` significa «no se puede convertir», que no es lo mismo que cero.
  aBolivares: (monto: number, moneda: LedgerCurrency | null) => number | null;
  desdeBolivares: (bs: number, moneda: LedgerCurrency | null) => number | null;
}): RepartoMulti {
  const porOrden = [...fiados].sort(porGravedad(ahora));
  const lineas = new Map<string, LineaDelRepartoMulti>();
  let quedaBs = Math.max(0, montoBs);

  const vacia = (f: FiadoParaRepartirMulti, aManoFlag: boolean): LineaDelRepartoMulti => ({
    movementId: f.movementId,
    asignado: 0,
    asignadoBs: 0,
    currency: f.currency,
    aMano: aManoFlag,
  });

  // Una línea, de la forma que sea: convertir, topar y descontar. Está aquí
  // dentro y no fuera porque cierra sobre `quedaBs`, que es lo que el reparto
  // va gastando — sacarla exigiría devolver el resto y volver a asignarlo, que
  // es justo donde se cuelan los céntimos.
  const colocar = (f: FiadoParaRepartirMulti, topeEnSuLibro: number, aManoFlag: boolean) => {
    const enBs = aBolivares(topeEnSuLibro, f.currency);
    if (enBs == null) {
      lineas.set(f.movementId, vacia(f, aManoFlag));
      return;
    }
    const tomaBs = redondear(Math.min(enBs, quedaBs));
    const enSuLibro = desdeBolivares(tomaBs, f.currency);
    // EL SEGUNDO TOPE, tras la vuelta. Ver la cabecera.
    const asignado = enSuLibro == null ? 0 : redondear(Math.min(enSuLibro, f.pendiente));

    lineas.set(f.movementId, {
      movementId: f.movementId,
      asignado,
      asignadoBs: asignado > HOLGURA ? tomaBs : 0,
      currency: f.currency,
      aMano: aManoFlag,
    });
    if (asignado > HOLGURA) quedaBs = redondear(quedaBs - tomaBs);
  };

  // PRIMERO LO FIJADO A MANO. Su decisión manda sobre el automático, y hasta
  // que no se descuenta no se sabe cuánto queda para los demás. Es el mismo
  // orden que `repartir`, y por el mismo motivo.
  for (const f of porOrden) {
    const puesto = aMano[f.movementId];
    if (puesto == null) continue;
    colocar(f, Math.max(0, Math.min(puesto, f.pendiente)), true);
  }

  // Y EL RESTO BAJA POR GRAVEDAD HASTA AGOTARSE, cruzando libros.
  for (const f of porOrden) {
    if (lineas.has(f.movementId)) continue;
    if (quedaBs <= HOLGURA) {
      lineas.set(f.movementId, vacia(f, false));
      continue;
    }
    colocar(f, f.pendiente, false);
  }

  const enOrden = porOrden.map((f) => lineas.get(f.movementId)!);
  const repartidoBs = redondear(enOrden.reduce((s, l) => s + l.asignadoBs, 0));

  return {
    lineas: enOrden,
    repartidoBs,
    sinAsignarBs: redondear(Math.max(0, montoBs) - repartidoBs),
  };
}

/**
 * Lo que el cliente debe en TODOS sus libros, en bolívares: el tope del monto
 * que se puede teclear cuando se paga en bolívares.
 *
 * Un fiado cuya moneda no se puede convertir no suma. Es a propósito y tiene
 * que ser coherente con el reparto, que tampoco lo incluye: si el tope y lo
 * repartible salieran de listas distintas, la pantalla aceptaría una cifra que
 * luego no cabe en ningún sitio.
 */
export function deudaEnBolivares(
  fiados: FiadoParaRepartirMulti[],
  aBolivares: (monto: number, moneda: LedgerCurrency | null) => number | null,
): number {
  return redondear(fiados.reduce((s, f) => s + (aBolivares(f.pendiente, f.currency) ?? 0), 0));
}
