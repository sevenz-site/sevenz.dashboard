import { calcularCuotas } from "@/lib/cuotas";

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
