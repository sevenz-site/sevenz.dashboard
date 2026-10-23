import { calcularCuotas } from "@/lib/cuotas";
import { getClientStatus, type ClientStatus } from "@/lib/types";

// LOS TRES ESTADOS DE UN PLAZO, y a qué cuota pertenece cada abono.
//
// Encargo del dueño el 2026-10-20, frames `1487:9884` y `1489:10209`: un fiado
// enseña su estado en la fila del historial, cada cuota el suyo en la columna
// «Estado», y cada abono lleva un chip al lado de su fecha.
//
// ===========================================================================
// QUÉ MIDE EL CHIP DE UN ABONO, porque no es obvio y se preguntó
//
// *«El chip mide el estado de la cuota que cubrió, si está en el plazo de la
// fecha de la cuota que se estableció en la sección de cuotas»* — respuesta
// del dueño el 2026-10-20, preguntado antes de construirlo porque había dos
// lecturas razonables y la otra era «si el abono llegó antes del vencimiento
// del fiado entero».
//
// Así que cada abono se atribuye a **la primera cuota que todavía no estaba
// cubierta cuando ese abono se hizo**, y el chip dice si llegó a tiempo para
// ESA cuota — no para el fiado.
//
// ===========================================================================
// «PAGADO» ES UN RÓTULO, NO UN CAMBIO EN EL PUNTAJE
//
// Se comprobó antes de escribir esto: `computeCreditScore` ya evalúa cada
// fiado como `onTime: cerrado <= vencimiento`, así que un fiado saldado al
// 100 % antes de su plazo YA suma hoy y alimenta «Puntualidad histórica». La
// fórmula no se toca, y no se toca por una razón que conviene no redescubrir:
// ese puntaje no se guarda, se calcula al dibujar. Cambiarlo movería el de
// todos los clientes de los 24 negocios el mismo día.

export type EstadoDelPlazo = "dentro" | "vencido" | "pagado";

export const ETIQUETA_DEL_ESTADO: Record<EstadoDelPlazo, string> = {
  dentro: "Dentro del plazo",
  vencido: "Plazo vencido",
  pagado: "Pagado",
};

// Medio céntimo, el mismo que usan `registrarVenta` y `registrarAbonoDirigido`
// al comparar dinero. Sin él, una cuota cubierta por 33,329999 contra 33,33 se
// leería como pendiente para siempre.
const HOLGURA = 0.005;

export type AbonoParaEstado = {
  fecha: string;
  amount: number;
};

export type CuotaConEstado = {
  numero: number;
  fecha: Date;
  monto: number;
  estado: EstadoDelPlazo;
};

/**
 * El estado de cada cuota, y el de cada abono, de un mismo fiado.
 *
 * Se resuelven JUNTOS a propósito: los dos salen del mismo recorrido —cuánto
 * llevaba abonado el fiado en cada momento—, y calcularlos por separado es
 * cómo acaban contradiciéndose. Una cuota marcada «Pagado» cuyo abono dice
 * «Plazo vencido» es posible y correcta (se pagó tarde); lo que no puede pasar
 * es que una cuota salga pendiente y ningún abono la esté empujando.
 *
 * `abonoInicial` entra como si fuera el primer abono, con la fecha del fiado:
 * lo es. La migración `129` existe justamente porque ese pago vive en
 * `sale_payments` y no en `movements`.
 */
export function estadosDelFiado({
  createdAt,
  plazoDias,
  cuotas,
  amount,
  abonoInicial = 0,
  abonos = [],
  ahora = new Date(),
}: {
  createdAt: string;
  plazoDias: number;
  cuotas: number;
  amount: number;
  abonoInicial?: number;
  abonos?: AbonoParaEstado[];
  ahora?: Date;
}): { cuotas: CuotaConEstado[]; abonos: EstadoDelPlazo[] } {
  const filas = calcularCuotas({ createdAt, plazoDias, cuotas, amount });

  // El umbral acumulado de cada cuota: la 2 está cubierta cuando lo abonado
  // supera la 1 MÁS la 2, no solo la 2.
  const umbrales: number[] = [];
  let acumulado = 0;
  for (const f of filas) {
    acumulado += f.monto;
    umbrales.push(Math.round(acumulado * 100) / 100);
  }

  // ── EL RECORRIDO, en orden de fecha ───────────────────────────────────
  //
  // El inicial primero, con la fecha del fiado; luego los dirigidos, ordenados.
  // Si dos caen el mismo día el orden entre ellos no cambia ningún resultado:
  // lo único que importa es cuánto llevaba abonado, que es una suma.
  const pagos: AbonoParaEstado[] = [
    ...(abonoInicial > HOLGURA ? [{ fecha: createdAt, amount: abonoInicial }] : []),
    ...[...abonos].sort((a, b) => a.fecha.localeCompare(b.fecha)),
  ];

  const estadoDeAbonos: EstadoDelPlazo[] = [];
  let pagado = 0;
  for (const p of pagos) {
    // A QUÉ CUOTA SE ATRIBUYE: la primera que todavía no estaba cubierta
    // ANTES de este abono. Es la que el cliente estaba pagando.
    const objetivo = umbrales.findIndex((u) => pagado + HOLGURA < u);
    pagado = Math.round((pagado + p.amount) * 100) / 100;

    if (objetivo < 0) {
      // Pagó de más: no quedaba ninguna cuota por cubrir. No es un error —el
      // tope lo impone la acción, no esto— y se cuenta como pagado.
      estadoDeAbonos.push("pagado");
      continue;
    }
    // El chip del abono: ¿llegó antes del vencimiento de ESA cuota?
    const vence = filas[objetivo].fecha.getTime();
    estadoDeAbonos.push(new Date(p.fecha).getTime() <= vence ? "dentro" : "vencido");
  }

  // ── EL ESTADO DE CADA CUOTA, con el total ya abonado ──────────────────
  const conEstado: CuotaConEstado[] = filas.map((f, i) => ({
    numero: f.numero,
    fecha: f.fecha,
    monto: f.monto,
    estado:
      pagado + HOLGURA >= umbrales[i]
        ? "pagado"
        : f.fecha.getTime() < ahora.getTime()
          ? "vencido"
          : "dentro",
  }));

  return { cuotas: conEstado, abonos: estadoDeAbonos };
}

/**
 * El estado de un fiado ENTERO, para la fila del historial.
 *
 * Un fiado sin cuotas tiene una sola fecha que cumplir —su plazo— y se juzga
 * contra ella. Uno con cuotas se juzga contra la primera que siga sin cubrir:
 * es la misma regla que ya usa `computeCreditScore` desde la migración `118`,
 * y tenerlas separadas sería que la pantalla dijera una cosa y el puntaje otra
 * sobre el mismo cliente.
 *
 * Sin plazo no hay nada que juzgar y devuelve `null`: la fila no dibuja chip.
 * Es el caso de casi todo lo que entra por la libreta.
 */
export function estadoDelFiado({
  createdAt,
  plazoDias,
  cuotas,
  amount,
  pendiente,
  ahora = new Date(),
}: {
  createdAt: string;
  plazoDias: number | null;
  cuotas: number | null;
  amount: number;
  // Lo que ESE fiado todavía debe, de `get_open_charges_for_client`. Cero —o
  // ausente de la lista de abiertos— es un fiado saldado.
  pendiente: number;
  ahora?: Date;
}): EstadoDelPlazo | null {
  // SALDADO MANDA SOBRE TODO LO DEMÁS, incluso si se pagó tarde. La fila dice
  // en qué quedó la cuenta; que se pagara con retraso lo cuenta el chip del
  // abono que lo saldó, y lo cobra el puntaje.
  if (pendiente <= HOLGURA) return "pagado";
  if (plazoDias == null) return null;

  if (cuotas != null && cuotas > 1) {
    // NO PIDE LA LISTA DE ABONOS, Y NO ES UN ATAJO. El estado de una cuota
    // depende solo de CUÁNTO se lleva abonado en total --mira los `umbrales`
    // de `estadosDelFiado`--, nunca de en cuántas veces se pagó ni de cuándo.
    // Y ese total ya lo tiene esta función: es `amount - pendiente`.
    //
    // Hacérselo pedir al historial habría significado una consulta más por
    // fiado para un dato que ya viajaba, y sobre todo una forma nueva de
    // equivocarse: quien olvidara pasar los abonos recibiría un estado
    // perfectamente formado y falso --«Plazo vencido» en un fiado con sus dos
    // primeras cuotas pagadas-- sin un solo error por ningún lado.
    //
    // Se pasa como `abonoInicial` porque esa es la ranura del acumulado de
    // partida. Lo que se pierde al hacerlo son los chips POR abono, que esta
    // función no devuelve ni usa.
    const { cuotas: filas } = estadosDelFiado({
      createdAt,
      plazoDias,
      cuotas,
      amount,
      abonoInicial: Math.max(0, Math.round((amount - pendiente) * 100) / 100),
      ahora,
    });
    const siguiente = filas.find((c) => c.estado !== "pagado");
    return siguiente ? siguiente.estado : "pagado";
  }

  const vence = new Date(createdAt).getTime() + plazoDias * 24 * 60 * 60 * 1000;
  return ahora.getTime() > vence ? "vencido" : "dentro";
}

// ===========================================================================
// EL ORDEN POR GRAVEDAD, Y POR QUÉ VIVE AQUÍ
//
// Encargo del dueño el 2026-10-22, para el reparto de un abono: *«Sevenz
// asigna los otros 10 restantes al siguiente abono disponible por gravedad de
// estado»*. El dinero cae por el fiado más grave primero.
//
// Las tres claves son LAS MISMAS de la migración `134`, que es la que decide
// el chip de estado del cliente, y eso no es casualidad ni copia: si la
// pantalla repartiera con un orden y el chip señalara otro, el tendero vería
// marcado «Crítico» un fiado al que el reparto no le puso nada.
//
// Lo que NO se repite es el cálculo del vencimiento con cuotas: eso se lo
// pregunta a `estadosDelFiado`, que ya lo resuelve y es de donde salen los
// estados de la tabla de cuotas. Una segunda forma de calcular cuándo vence
// la cuota 3 de 5 es exactamente lo que `CT-124` costó en su día.

/**
 * Cuándo vence DE VERDAD un fiado, que con cuotas no es su fecha final.
 *
 * Un fiado de 5 cuotas a 90 días no vence a los 90: vence por partes, y lo que
 * decide su gravedad hoy es la primera cuota que todavía no está cubierta.
 * Pedirle la fecha final sería tratar como «dentro del plazo» un fiado con
 * tres cuotas vencidas.
 *
 * `null` cuando no hay plazo: no hay nada que vencer, y el orden de abajo lo
 * trata aparte en vez de inventarle una fecha.
 */
export function vencimientoEfectivo({
  createdAt,
  plazoDias,
  cuotas,
  amount,
  pendiente,
  ahora = new Date(),
}: {
  createdAt: string;
  plazoDias: number | null;
  cuotas: number | null;
  amount: number;
  pendiente: number;
  ahora?: Date;
}): Date | null {
  if (plazoDias == null) return null;

  if (cuotas != null && cuotas > 1) {
    const { cuotas: filas } = estadosDelFiado({
      createdAt,
      plazoDias,
      cuotas,
      amount,
      abonoInicial: Math.max(0, Math.round((amount - pendiente) * 100) / 100),
      ahora,
    });
    const siguiente = filas.find((c) => c.estado !== "pagado");
    // Todas cubiertas y aún queda pendiente: no puede pasar con los umbrales
    // de `estadosDelFiado`, pero si pasara, la última fecha es la respuesta
    // menos sorprendente --y desde luego mejor que `null`, que lo mandaría al
    // final del orden como si no tuviera plazo--.
    return siguiente ? siguiente.fecha : (filas.at(-1)?.fecha ?? null);
  }

  return new Date(new Date(createdAt).getTime() + plazoDias * 24 * 60 * 60 * 1000);
}

export type FiadoOrdenable = {
  createdAt: string;
  plazoDias: number | null;
  cuotas: number | null;
  amount: number;
  pendiente: number;
};

/**
 * El comparador del reparto: el más grave primero.
 *
 * Tres claves, en este orden y con esta razón cada una:
 *
 *   1. **Vencido antes que al día.** Lo que ya se pasó de fecha es lo que hay
 *      que ir a cobrar; lo que está dentro de plazo todavía no es un problema.
 *   2. **Entre los vencidos, el que TENÍA plazo antes que el que no.** «Plazo
 *      vencido» dice que había una fecha y se pasó —algo acordado que se
 *      incumplió—; «sin plazo» dice que nunca se puso ninguna, que es otra
 *      cosa y no necesariamente peor. Decisión del dueño del 2026-10-21.
 *   3. **El más vencido primero**, por su vencimiento efectivo.
 *
 * `ahora` entra como argumento y no se lee dentro: el orden y los rótulos que
 * la pantalla pinta al lado tienen que salir del MISMO instante, o la lista
 * puede ordenarse de una forma y rotularse de otra sin que nada falle.
 */
export function porGravedad(ahora: Date) {
  const t = ahora.getTime();

  // SIN PLAZO, LA FECHA DEL PROPIO FIADO. Es el `coalesce(vence, charge_at)`
  // de la `134`, copiado a conciencia: un fiado al que nunca se le puso fecha
  // no es «no vencido», es uno que lleva ahí desde que se tomó. Mandarlo al
  // final del orden —lo que hacía este comparador antes de que `qa:reparto` lo
  // cazara— dejaría sin cobrar el más viejo de la lista por no haberle puesto
  // plazo, que es justo al revés de lo que el tendero espera.
  const efectivo = (f: FiadoOrdenable): number =>
    (vencimientoEfectivo({ ...f, ahora }) ?? new Date(f.createdAt)).getTime();

  return (a: FiadoOrdenable, b: FiadoOrdenable): number => {
    const ea = efectivo(a);
    const eb = efectivo(b);

    const venA = ea < t;
    const venB = eb < t;
    if (venA !== venB) return venA ? -1 : 1;

    // Entre los vencidos, el que tiene plazo manda. Fuera de los vencidos la
    // distinción no aplica: un fiado sin plazo no está «dentro» de nada.
    if (venA && (a.plazoDias == null) !== (b.plazoDias == null)) {
      return a.plazoDias == null ? 1 : -1;
    }

    return ea - eb;
  };
}

// ===========================================================================
// UN ESTADO POR LIBRO, Y EL PEOR DE ELLOS
//
// Requested by the owner on 2026-10-23: *«cada card de total por cobrar lleva
// su propio chip y prela el más grave sobre el estado general del cliente»*.
//
// WHY THE CLIENT-WIDE STATUS COULD NOT ANSWER THIS, which is the part worth
// keeping: `client_summary` carries ONE `worst_unpaid_charge_*` across both
// ledgers, and the page fed `getClientStatus` a balance converted to dollars.
// So a client $158.50 in credit and €3.50 in debt came out as a single
// «A favor» — the exact screen the owner reported, with the euro debt
// invisible behind a green chip. The two ledgers are never summed anywhere
// else in the app; the status was the last place that still did.
//
// SAME DERIVATION FOR BOTH VIEWS, on purpose. The shopkeeper's page and the
// client's `/s/[token]` both call this with the same shape, so the chip the
// client sees cannot disagree with the one the owner sees. Two derivations of
// one figure is how the $89.72-vs-$68.59 row happened on 2026-10-21.
export type CargoAbierto = FiadoOrdenable & {
  // `null` is a Colombian business's ledger, not «no currency» — the same
  // distinction `get_open_charges_for_client` keeps in SQL.
  currency: string | null;
};

// The key a ledger goes under. `COP` for a Colombian business, matching the
// `saldoPorMoneda` convention the two history lists already use.
export function libroDe(currency: string | null): string {
  return currency ?? "COP";
}

export function estadoPorLibro({
  saldos,
  abiertos,
  daysSincePayment,
  ahora = new Date(),
}: {
  // One entry per ledger the screen draws a card for, keyed by `libroDe`.
  // A ledger absent from here gets no status, and one present with a zero
  // balance gets «Sin deuda» — which is the answer, not a missing one.
  saldos: Partial<Record<string, number>>;
  abiertos: CargoAbierto[];
  // Client-wide, from `client_summary`, and deliberately so: «has not paid
  // anything in N days» is a fact about the client, not about one ledger.
  // It only decides «Crítico». The client's own view has no such figure and
  // passes zero, so that view never says «Crítico» — stated here because a
  // reader comparing the two screens would otherwise call it a bug.
  daysSincePayment: number;
  ahora?: Date;
}): Record<string, ClientStatus> {
  const porLibro: Record<string, CargoAbierto[]> = {};
  for (const c of abiertos) {
    if (c.pendiente <= HOLGURA) continue;
    const libro = libroDe(c.currency);
    (porLibro[libro] ??= []).push(c);
  }

  const estados: Record<string, ClientStatus> = {};
  for (const [libro, saldo] of Object.entries(saldos)) {
    if (saldo == null) continue;

    // THE WORST OPEN CHARGE OF THIS LEDGER, by the same rule
    // `client_summary` applies to the whole client: the one whose own due
    // date sits furthest back, or, with none overdue, the one that falls due
    // first. That is exactly what `porGravedad` orders, so the rule lives in
    // one comparator instead of being restated here.
    const peor = [...(porLibro[libro] ?? [])].sort(porGravedad(ahora))[0] ?? null;

    // HALF A CENT IS NOT A DEBT. `getClientStatus` compares the balance to
    // zero exactly, so a ledger left at 0,004 by rounding would be judged as
    // owing money while its card prints $0,00 — a chip contradicting the
    // figure right next to it.
    const neto = Math.abs(saldo) <= HOLGURA ? 0 : saldo;

    estados[libro] = getClientStatus({
      balance: neto,
      daysSincePayment,
      worstChargeAt: peor?.createdAt ?? null,
      worstChargePlazoDias: peor?.plazoDias ?? null,
      // The database's `worst_unpaid_charge_due_at` for one fiado, computed
      // here because this list has what it takes: with cuotas it is the next
      // unpaid instalment's date, without them the end of the plazo.
      worstChargeDueAt: peor
        ? (vencimientoEfectivo({ ...peor, ahora })?.toISOString() ?? null)
        : null,
    });
  }
  return estados;
}

// EL ORDEN DE GRAVEDAD, del peor al que no es problema. The two at the bottom
// are not problems at all and their order only decides which of them a client
// with nothing pending shows: «A favor» says more than «Sin deuda», so it
// wins.
const GRAVEDAD_DEL_ESTADO: Record<ClientStatus, number> = {
  critico: 5,
  plazo_vencido: 4,
  sin_plazo: 3,
  dentro_del_plazo: 2,
  a_favor: 1,
  sin_deuda: 0,
};

/** El estado general del cliente: el más grave de sus libros. */
export function peorEstado(estados: ClientStatus[]): ClientStatus {
  let peor: ClientStatus = "sin_deuda";
  for (const e of estados) {
    if (GRAVEDAD_DEL_ESTADO[e] > GRAVEDAD_DEL_ESTADO[peor]) peor = e;
  }
  return peor;
}
