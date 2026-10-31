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

// ===========================================================================
// THE NOTE DECIDES THE LEDGER TOTAL, NOT THE SUM OF ITS LINES
//
// Owner's decision of 2026-10-30, asked as a straight choice: «Manda el
// billete». Bs. 10.000 split by hand as 5.000 + 5.000 between two dollar
// fiados converted each half on its own -- 5.000 ÷ 889,25 = 5,6227 -> $5,62,
// twice -- and stored $11,24, while the same note split automatically stored
// $11,25. Measured in production that day (abono HDXR320). The rounding runs
// both ways: Bs. 5.000 + 5.000 into euros gives €5,04 + €5,04 = €10,08,
// against €10,07 for the whole note.
//
// So within one ledger, the lines must add up to the conversion of the
// bolivars they took TOGETHER, and the difference goes to the LAST line that
// has room for it under its `pendiente` -- the same "last one absorbs the
// rest" rule `calcularCuotas` and the bolivar figures of a split follow.
//
// The cost, accepted with the decision: the line that absorbs it no longer
// reads as the exact conversion of its own bolivars (Bs. 5.000 -> $5,63). The
// bolivars themselves are never touched: they are what the shopkeeper typed.
//
// ONLY LINES WHOSE BOLIVARS STILL DESCRIBE THEM take part. A line cut down by
// its `pendiente` converts to more than it holds, and counting its bolivars
// would push real money onto another fiado instead of a rounding cent.
//
// `lines` must already be in a stable order -- the caller's split order --
// because "last" has to mean the same line on the screen and on the server.
export function absorbLedgerCents(
  lines: { movementId: string; asignado: number; bs: number; pendiente: number }[],
  fromBolivars: (bs: number) => number | null,
): Map<string, number> {
  const result = new Map(lines.map((l) => [l.movementId, l.asignado]));
  const exact = lines.filter((l) => {
    if (!(l.asignado > HOLGURA) || !(l.bs > 0)) return false;
    const own = fromBolivars(l.bs);
    return own != null && Math.abs(own - l.asignado) <= HOLGURA;
  });
  if (exact.length < 2) return result;
  const converted = fromBolivars(redondear(exact.reduce((acc, l) => acc + l.bs, 0)));
  if (converted == null) return result;
  // Rounded to the cent BEFORE comparing: the screen converts with `priceIn`,
  // which does not round, and the server does. Unrounded, the two could move
  // the cent to different lines.
  const total = redondear(converted);
  const diff = redondear(total - exact.reduce((acc, l) => acc + l.asignado, 0));
  if (Math.abs(diff) <= HOLGURA) return result;
  for (let i = exact.length - 1; i >= 0; i--) {
    const next = redondear(exact[i].asignado + diff);
    if (next > HOLGURA && next <= exact[i].pendiente + 1e-9) {
      result.set(exact[i].movementId, next);
      break;
    }
  }
  return result;
}

// The same rule for the screen's state that splits in ONE ledger's currency
// while each pinned line was typed in bolivars. There the pinned figures ARE
// the split, so they are adjusted BEFORE splitting, by this one function on
// both sides: the button, the total that travels and what gets stored are
// then the same number, and the server still recognises each line as the one
// the shopkeeper typed (it compares the stored amount with the pinned one).
//
// Ordered by `porGravedad`, the order `repartir` places lines in, so the
// screen and the server pick the same "last" line.
export function absorbPinnedCents({
  fiados,
  aMano,
  aManoBs,
  ahora = new Date(),
  fromBolivars,
}: {
  fiados: (FiadoParaRepartir & { currency?: LedgerCurrency | null })[];
  aMano: Record<string, number>;
  aManoBs: Record<string, number>;
  ahora?: Date;
  fromBolivars: (bs: number, currency: LedgerCurrency | null) => number | null;
}): Record<string, number> {
  const adjusted = { ...aMano };
  const byLedger = new Map<string, { currency: LedgerCurrency | null; lines: { movementId: string; asignado: number; bs: number; pendiente: number }[] }>();
  for (const f of [...fiados].sort(porGravedad(ahora))) {
    const pinned = aMano[f.movementId];
    const bs = aManoBs[f.movementId];
    if (pinned == null || bs == null) continue;
    const currency = (f.currency ?? null) as LedgerCurrency | null;
    const key = currency ?? "COP";
    const group = byLedger.get(key) ?? { currency, lines: [] };
    group.lines.push({
      movementId: f.movementId,
      asignado: Math.max(0, Math.min(pinned, f.pendiente)),
      bs,
      pendiente: f.pendiente,
    });
    byLedger.set(key, group);
  }
  for (const { currency, lines } of byLedger.values()) {
    const fixed = absorbLedgerCents(lines, (bs) => fromBolivars(bs, currency));
    for (const l of lines) {
      const value = fixed.get(l.movementId);
      if (value != null && value !== l.asignado) adjusted[l.movementId] = value;
    }
  }
  return adjusted;
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
  aManoBs = {},
  ahora = new Date(),
  aBolivares,
  desdeBolivares,
}: {
  montoBs: number;
  fiados: FiadoParaRepartirMulti[];
  // movementId → importe fijado a mano, EN LA MONEDA DE SU FIADO.
  aMano?: Record<string, number>;
  // ── LOS BOLÍVARES QUE SE TECLEARON PARA ESA LÍNEA, SI SE TECLEARON ──
  //
  // movementId → bolívares. Cuando están, SON el tope de la línea en este
  // reparto, y no `aBolivares(aMano)`.
  //
  // POR QUÉ, y es un fallo medido (R-1.2, 2026-10-30): `aMano` es esos
  // bolívares pasados al libro y redondeados al céntimo —Bs 6.000 ÷ 992,80 =
  // €6,0435 → €6,04— y volver a convertirlo da Bs 5.996,51. Cuando el
  // redondeo iba hacia abajo, las partes sumaban menos que el billete, sobraban
  // unos bolívares sin asignar y la acción rechazaba el abono entero con «No
  // pudimos repartir todo el abono». Con dos fiados en dólares y cifras de
  // Bs 500 a 9.000 en cada uno, pasaba en 636 de 1.225 combinaciones.
  //
  // SOLO SI SIGUEN DICIENDO LO MISMO QUE `aMano`: la línea vale si esos
  // bolívares, pasados al libro, dan la cifra fijada (al medio céntimo). Si el
  // tendero cambió la cifra después, los bolívares viejos no describen la
  // línea y se ignoran — es la misma regla que `sigueEnteraLaSuya` aplica al
  // guardar.
  aManoBs?: Record<string, number>;
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
  const colocar = (
    f: FiadoParaRepartirMulti,
    topeEnSuLibro: number,
    aManoFlag: boolean,
    // Los bolívares tecleados para esta línea, ya validados: mandan sobre la
    // conversión de `topeEnSuLibro`. Ver `aManoBs` arriba.
    topeEnBs: number | null = null,
  ) => {
    const enBs = topeEnBs ?? aBolivares(topeEnSuLibro, f.currency);
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
    const tope = Math.max(0, Math.min(puesto, f.pendiente));
    const bs = aManoBs[f.movementId];
    const enSuLibro = bs != null && bs > 0 ? desdeBolivares(bs, f.currency) : null;
    const bsValidos = enSuLibro != null && Math.abs(enSuLibro - tope) <= HOLGURA ? bs : null;
    colocar(f, tope, true, bsValidos);
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

  // THE NOTE DECIDES EACH LEDGER'S TOTAL (owner's decision of 2026-10-30):
  // see `absorbLedgerCents`. Bolivars per line are left exactly as placed.
  const porLibro = new Map<string, FiadoParaRepartirMulti[]>();
  for (const f of porOrden) {
    const key = f.currency ?? "COP";
    porLibro.set(key, [...(porLibro.get(key) ?? []), f]);
  }
  for (const delLibro of porLibro.values()) {
    const moneda = delLibro[0].currency;
    const ajustadas = absorbLedgerCents(
      delLibro.map((f) => {
        const l = lineas.get(f.movementId)!;
        return { movementId: f.movementId, asignado: l.asignado, bs: l.asignadoBs, pendiente: f.pendiente };
      }),
      (bs) => desdeBolivares(bs, moneda),
    );
    for (const [id, asignado] of ajustadas) {
      const l = lineas.get(id)!;
      if (l.asignado !== asignado) lineas.set(id, { ...l, asignado });
    }
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

// ===========================================================================
// WHICH UNIT THE SPLIT IS COUNTED IN -- AND THE ONE THAT TRAVELS
//
// Two booleans that must never disagree, and the day they did it cost real
// money. Measured in production on 2026-10-29: the split screen sent
// `montoTecleado: 11.25` --a figure in DOLLARS-- labelled
// `monedaTecleada: "VES"`. The server did exactly as told, read 11,25 as
// bolivares, converted them, and stored **one cent** against the Bs. 10.000
// the shopkeeper had in his hand. Nothing errored: the screen said
// "registrado con exito" and the debt moved by $0,01.
//
// ---------------------------------------------------------------------------
// WHY THEY ARE RESOLVED TOGETHER AND NOT SEPARATELY
//
// `cruzaLibros` picks the ARITHMETIC (bolivars across every ledger, or the
// ledger's own currency) and `totalInBolivars` declares the UNIT the total is
// written in. Computed apart, in two expressions a hundred lines from each
// other, they drifted -- which is the whole bug. Returned from one place they
// cannot, and the table in `qa/reparto.mjs` is what holds that.
//
// ---------------------------------------------------------------------------
// THE FOUR CASES, AND WHY THE THIRD ONE IS NEW
//
//   chip  | ledgers | total written    | crosses | in Bs | why
//   ------+---------+------------------+---------+-------+---------------------
//   Bs    |    1    | in the field     |  false  | true  | the field IS bolivars
//   Bs    |   2+    | in the field     |  true   | true  | owner's 2026-10-23
//   Bs    |    1    | fixed line by line| true   | true  | <- the fix
//   other |   any   | either           |  false  | false | the ledger's own
//
// Row 3 is the one that changes, and it displaces half of a decision written
// in `abono-reparto.tsx` on 2026-10-23: *"con un solo libro no cambia nada (...)
// meterlo por la rama nueva cambiaria su aritmetica (la ida y vuelta de la
// conversion) sin que nadie lo haya pedido"*. That reasoning was right about
// the case it was written for --an amount typed into the field, which is
// already bolivars and needs no crossing-- and it does not survive the
// screen's SECOND state, where the total is the sum of per-fiado figures the
// shopkeeper typed in bolivars. There, counting in the ledger's currency is
// not "the old path": it is a sum in dollars wearing a bolivar label.
//
// AND IT BUYS THE HARD STOP, which is the real reason to prefer this over
// merely relabelling the payload. `armarRepartoCruzandoLibros` refuses to
// write when the per-line bolivars do not add up to the note -- the guard
// added on 2026-10-24 after Bs. 200.000 was stored as Bs. 200.005,87. The
// single-ledger branch has no equivalent for a total it never received in
// bolivars, so relabelling alone would have fixed this instance and left the
// next one just as silent.
export function resolveSplitUnits({
  enBolivares,
  numeroDeLibros,
  porLinea,
}: {
  /** The currency chip reads "Bolivares". */
  enBolivares: boolean;
  /** How many ledgers this client actually owes in. */
  numeroDeLibros: number;
  /**
   * The screen's second state: no amount field, the total is the sum of what
   * the shopkeeper fixed fiado by fiado.
   */
  porLinea: boolean;
}): { crossesLedgers: boolean; totalInBolivars: boolean } {
  return {
    crossesLedgers: enBolivares && (numeroDeLibros > 1 || porLinea),
    // WITHOUT EXCEPTION, and that is the point: once the total is always
    // counted in the unit the chip names, the unit that travels is just the
    // chip. The bug existed because this answer was derived twice.
    totalInBolivars: enBolivares,
  };
}

// ===========================================================================
// THE TOTAL WHEN THERE IS NO FIELD: THE SUM OF THE LINES ALREADY FIXED
//
// The screen's second state has no amount box. The total is whatever the
// shopkeeper has pinned fiado by fiado, and **this sum is where the unit is
// decided** -- which is why it lives out here next to `resolveSplitUnits`
// instead of inside a `useMemo`.
//
// That is the whole lesson of 2026-10-29. The label was fixed by one line in
// the payload, but the defect was never only the label: it was that the sum
// and the label answered the same question in two places. A regression test
// that builds its own total in bolivars proves nothing -- it was tried, and
// it passed against the broken code. Only a test that sums the way the screen
// sums can go red.
//
// `crossesLedgers` FROM `resolveSplitUnits`, always. Passing a hand-written
// boolean here would re-open the exact gap this function closes.
export function sumFixedLines({
  fiados,
  aMano,
  aManoBs,
  crossesLedgers,
  aBolivares,
}: {
  fiados: { movementId: string; pendiente: number; currency?: LedgerCurrency | null }[];
  /** What was pinned on each fiado, in that fiado's own ledger currency. */
  aMano: Record<string, number>;
  /** And what he typed in bolivars for it, when he typed it that way. */
  aManoBs: Record<string, number>;
  crossesLedgers: boolean;
  aBolivares: (monto: number, moneda: LedgerCurrency | null) => number | null;
}): number {
  return fiados.reduce((suma, f) => {
    const puesto = aMano[f.movementId];
    if (puesto == null) return suma;
    const topado = Math.max(0, Math.min(puesto, f.pendiente));
    // NOT CROSSING: every line is already in the one ledger's currency, so the
    // sum is too, and no rate is involved.
    if (!crossesLedgers) return suma + topado;
    // HIS FIGURE FIRST, THE CONVERSION ONLY AFTER. Summing conversions turned
    // two lines of Bs. 100.000 into a button reading Bs. 200.005,87 on
    // 2026-10-24; the conversion is only for a line he pinned in the ledger's
    // own currency, where there is no typed bolivar figure to respect.
    const suyos = aManoBs[f.movementId];
    if (suyos != null && Math.abs(puesto - f.pendiente) > 0.005) return suma + suyos;
    if (suyos != null && puesto <= f.pendiente) return suma + suyos;
    return suma + (aBolivares(topado, (f.currency ?? null) as LedgerCurrency | null) ?? 0);
  }, 0);
}
