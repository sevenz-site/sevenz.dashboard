import { todayInCaracas } from "@/lib/exchange-rate/rate-status";

// La próxima tasa publicada, leída desde el servidor para poder guardarla.
//
// Las calculadoras ya leen esto en el navegador, pero el formulario de fiado no
// puede: quien decide qué tasa se sella en un movimiento es el servidor, y el
// servidor no puede fiarse de un número que le mande el navegador. Una petición
// hecha a mano podría sellar cualquier cifra en el respaldo. Así que la tasa
// prevista se guarda al mismo tiempo que la vigente, y el formulario solo manda
// una casilla marcada.
//
// SIN la lógica de la ventana. Aquí solo se guarda "cuál es la próxima y cuándo
// entra en vigor"; decidir si se le ofrece al dueño —viernes al mediodía, fin de
// semana— es cosa de la interfaz, y mezclarlo con el guardado significaría que
// el dato existe o no según la hora a la que corrió el cron.

const TIMEOUT_MS = 8_000;

type Entrada = { promedio: number; fecha: string };

export type PrevistaRemota = { fecha: string; usd: number; eur: number };

async function traer(url: string): Promise<Entrada[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
    return (await res.json()) as Entrada[];
  } finally {
    clearTimeout(timeout);
  }
}

// Devuelve null si no hay ninguna futura, que entre semana es lo normal. Nunca
// lanza: esto es un extra sobre la tasa vigente, y que falle no puede impedir
// que se guarde la tasa que sí rige hoy.
export async function fetchPrevista(): Promise<PrevistaRemota | null> {
  try {
    const hoy = todayInCaracas();
    const [usd, eur] = await Promise.all([
      traer("https://ve.dolarapi.com/v1/historicos/dolares/oficial"),
      traer("https://ve.dolarapi.com/v1/historicos/euros/oficial"),
    ]);

    const eurPorFecha = new Map(eur.map((e) => [e.fecha, e.promedio]));
    const futuras = usd
      .filter((e) => e.fecha > hoy && eurPorFecha.has(e.fecha))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const proxima = futuras[0];
    if (!proxima) return null;
    return { fecha: proxima.fecha, usd: proxima.promedio, eur: eurPorFecha.get(proxima.fecha)! };
  } catch (error) {
    console.error(
      "[bcv] no pudimos leer la tasa prevista:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
