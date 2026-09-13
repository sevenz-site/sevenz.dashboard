// La próxima tasa del BCV: la que ya está publicada pero todavía no rige.
//
// POR QUÉ EXISTE. El BCV no publica sábados ni domingos, pero los negocios
// abren. El cliente llega con bolívares en la mano y el dueño tiene que decidir
// qué cifra en dólares anota — y si usa la tasa del viernes, pierde:
//
//   Bs. 45.000 a la tasa del viernes (832,49)  ->  le abona $54,05
//   Bs. 45.000 a la tasa del lunes   (842,21)  ->  le abona $53,43
//
// Sesenta y dos céntimos regalados por cada abono, todos los fines de semana,
// porque esos bolívares ya valen menos el lunes. Los dueños ya resuelven esto a
// mano; la app no les daba forma de hacerlo dentro.
//
// El proveedor publica la tasa con la fecha en que entra en vigor, no con la
// fecha en que se publica, así que el viernes por la tarde su histórico ya trae
// la entrada del lunes. Comprobado el 2026-09-13 contra ve.dolarapi.com: el
// domingo 13 la serie terminaba en 2026-09-15 con 842,2067.
//
// El día de la semana no se adivina ni se calcula con un calendario de
// feriados: sale de la fecha que manda el proveedor. Si el lunes es feriado
// bancario, la entrada viene con la fecha del martes y la etiqueta dice martes
// sola.

export type TasaPrevista = { fecha: string; usd: number; eur: number };

export type PuntoDeHistorial = { date: string; usd: number; eur: number };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Fecha, día de la semana y hora en Caracas. Vercel corre en UTC, así que leer
// la hora del servidor adelantaría el día a las 8 de la noche hora de Caracas
// — y este cálculo depende de qué día es y de si ya pasó el mediodía.
function ahoraEnCaracas(ahora: Date): { ymd: string; diaSemana: number; hora: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(ahora);

  const buscar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const abreviaturas: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    ymd: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    diaSemana: abreviaturas[buscar("weekday")] ?? 0,
    // "24" a medianoche en algunos entornos; el módulo lo vuelve 0.
    hora: Number(buscar("hour")) % 24,
  };
}

// "2026-09-15" -> "el lunes 15 sept." Se parte la cadena en vez de construir un
// Date: leer "2026-09-15" como fecha lo interpreta en UTC y en Caracas sería el
// 14, que es justo el error que este módulo existe para no cometer.
export function etiquetaDePrevista(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  // Mediodía UTC para que el desplazamiento de zona no mueva el día al calcular
  // qué día de la semana cae.
  const d = new Date(Date.UTC(anio, mes - 1, dia, 12));
  return `el ${DIAS[d.getUTCDay()]} ${dia} ${MESES[mes - 1]}.`;
}

// Devuelve la próxima tasa si toca ofrecerla, y null si no.
//
// La ventana va del viernes al mediodía hasta que esa tasa entra en vigor: el
// viernes por la tarde, el sábado y el domingo. Se apaga sola el lunes, cuando
// deja de ser futura y pasa a ser la tasa normal — no hay que acordarse de
// apagarla.
//
// La última condición, "hoy no tiene tasa propia", cubre el lunes feriado: ahí
// el lunes tampoco publica, la entrada futura sigue siendo la del martes, y el
// dueño sigue teniendo el mismo problema que el sábado.
export function tasaPrevistaDe(
  historial: PuntoDeHistorial[],
  ahora: Date = new Date(),
): TasaPrevista | null {
  const { ymd, diaSemana, hora } = ahoraEnCaracas(ahora);

  // La más cercana de las futuras, no la última de la lista: si el proveedor
  // llegara a traer dos, la que toca es la que entra en vigor primero.
  const futuras = historial
    .filter((p) => p.date > ymd)
    .sort((a, b) => a.date.localeCompare(b.date));
  const proxima = futuras[0];
  if (!proxima) return null;

  const hoyTieneTasa = historial.some((p) => p.date === ymd);
  const viernesPorLaTarde = diaSemana === 5 && hora >= 12;
  const finDeSemana = diaSemana === 6 || diaSemana === 0;

  if (!viernesPorLaTarde && !finDeSemana && hoyTieneTasa) return null;

  return { fecha: proxima.date, usd: proxima.usd, eur: proxima.eur };
}
