// El precio real del USDT en bolívares, leído del mercado P2P.
//
// ─────────────────────────────────────────────────────────────────────────
// FASE 1 DE TRES. HOY ESTO NO SE GUARDA NI SE ENSEÑA A NADIE.
//
// Solo corre dentro del cron de la tasa y escribe el resultado en el log. Lo
// único que mide es si CriptoYa responde todos los días — que es lo único que
// no se puede saber leyendo su documentación. La fase 2 (guardarlo y
// enseñarlo en la calculadora) va detrás de esa medición, no delante.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ NO SE USA LA FUENTE QUE YA ESTÁ INSTALADA
//
// `currency-api` —nuestro proveedor de respaldo— publica un campo `usdt.ves`.
// Es gratis, ya está integrado y sería lo más cómodo. Medido el 2026-09-24, a
// la misma hora:
//
//   currency-api usdt.ves .......  852,17   ← lo que daría "gratis"
//   BCV oficial ................   854,46
//   paralelo (dolarapi) ........   956,95
//   Binance P2P (CriptoYa) .....   966,60   ← lo que vale de verdad
//
// El campo de currency-api es el oficial disfrazado: sale de 1 USDT ≈ 1 USD
// multiplicado por la tasa oficial. Es correcto en aritmética y falso en la
// calle, por un 13,4 %. Un dueño que valore un fiado con esa cifra pierde ese
// 13,4 % en cada operación y no entiende por qué no le cuadra el mes. Por eso
// esto existe como fuente aparte y no como un campo más del proveedor viejo.
//
// ─────────────────────────────────────────────────────────────────────────
// CRIPTOYA, COMPROBADO EL 2026-09-24 CONTRA SU API Y SUS DOCS
//
// Pública, sin registro y sin clave. 120 peticiones por minuto; nosotros
// hacemos una al día. Actualiza cada minuto. Venezuela es un país soportado
// de forma explícita. No recibe ni un dato de ningún cliente: es una lectura
// saliente, así que no hay tratante de datos nuevo ni nada que declarar en la
// Política de Privacidad.

// DOS SEGUNDOS, NO OCHO COMO LOS DEMÁS. Y no es por prudencia genérica.
//
// `fetchAndStoreBcvRate` corre también en la ruta de ESCRITURA, cuando un
// dueño guarda un fiado y la tasa está vieja, con un presupuesto de 2,5 s. Va
// en un Promise.all, así que no suma su tiempo al de los demás... pero sí
// manda si resulta ser el más lento. Con 8 s, un mal día de CriptoYa se
// convierte en un dueño mirando una rueda girar mientras guarda su fiado.
// Con 2 s no puede ser nunca la razón de esa espera.
const TIMEOUT_MS = 2_000;

type Casa = { ask?: number; bid?: number };

export type UsdtP2p = {
  // La mediana de lo que piden los vendedores y de lo que ofrecen los
  // compradores, entre todas las casas que contestaron.
  ask: number;
  bid: number;
  // Cuántas casas entraron en el cálculo. Si un día son dos en vez de siete,
  // la mediana sigue saliendo pero vale mucho menos, y eso tiene que verse.
  casas: number;
  // La más barata y la más cara, para vigilar la dispersión. El 2026-09-24
  // seis casas estaban entre 967 y 972 y una —`saldo`— a 987,86: un 2 % por
  // encima del resto. Si algún día esta horquilla se dispara, el mercado está
  // roto o la fuente está mala, y en los dos casos hay que enterarse.
  min: number;
  max: number;
};

// La MEDIANA, nunca el promedio ni una sola casa.
//
// Lo que publican los P2P son anuncios, no operaciones cerradas: cualquiera
// puede poner una oferta absurda y aparecer en la lista. El promedio se la
// traga entera; la mediana la ignora. Y tomar una sola casa —Binance, por
// ejemplo— es quedarse a merced de que ESA tenga un mal día.
function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? (ordenados[medio - 1] + ordenados[medio]) / 2
    : ordenados[medio];
}

// Nunca lanza. Igual que `fetchPrevista`: esto es un extra sobre la tasa que
// sí rige, y que falle no puede impedir que se guarde la tasa oficial del día.
export async function fetchUsdtP2p(): Promise<UsdtP2p | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://criptoya.com/api/usdt/ves/1", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`criptoya respondió ${res.status}`);

    const data = (await res.json()) as Record<string, Casa>;

    // Se descarta cualquier casa a la que le falte un lado o venga en cero:
    // un cero entraría en la mediana como un precio válido y la hundiría.
    const asks = Object.values(data)
      .map((c) => c.ask)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const bids = Object.values(data)
      .map((c) => c.bid)
      .filter((n): n is number => typeof n === "number" && n > 0);

    // Menos de tres casas no es una mediana, es una anécdota.
    if (asks.length < 3 || bids.length < 3) {
      throw new Error(`solo ${asks.length} casas con precio válido`);
    }

    return {
      ask: mediana(asks),
      bid: mediana(bids),
      casas: asks.length,
      min: Math.min(...asks),
      max: Math.max(...asks),
    };
  } catch (error) {
    console.error(
      "[usdt] no pudimos leer el P2P:",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
