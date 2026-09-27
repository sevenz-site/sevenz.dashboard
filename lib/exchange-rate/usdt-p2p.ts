// El precio del USDT en bolívares. Binance P2P, que es lo que "el USDT"
// significa en Venezuela.
//
// ─────────────────────────────────────────────────────────────────────────
// FASE 1 DE TRES. HOY ESTO NO SE GUARDA NI SE ENSEÑA A NADIE.
//
// Solo corre dentro del cron de la tasa y escribe el resultado en el log. Lo
// único que mide es si la fuente responde todos los días — que es lo único
// que no se puede saber leyendo su documentación. La fase 2 (guardarlo y
// enseñarlo en la calculadora) va detrás de esa medición, no delante.
//
// ─────────────────────────────────────────────────────────────────────────
// BINANCE, NO UN AGREGADO DE CASAS. Corregido el 2026-09-24.
//
// La primera versión publicaba la mediana de las siete casas que devuelve
// CriptoYa. Era defendible en estadística y equivocada en producto: cuando un
// tendero venezolano dice "el USDT" quiere decir Binance P2P, que es donde
// mira. Si Sevenz enseña 971 y él abre Binance y lee 967,88, no concluye que
// está viendo una mediana — concluye que Sevenz está mal.
//
// Y medido, el agregado además era PEOR. El 2026-09-24:
//
//   binancep2p ..... 967,88   ← cotización de hace 21 segundos
//   bybitp2p ....... 967,39
//   okexp2p ........ 970,00
//   mexcp2p ........ 971,00
//   bingxp2p ....... 971,90
//   saldo .......... 988,61
//   bitgetp2p ...... 995,00
//   mediana de las otras seis: 971,45
//
// Las dos de arriba arrastran la mediana un 0,37 % por encima de Binance. El
// número más limpio era el de la casa de referencia, no el del conjunto.
//
// LAS DEMÁS NO SE TIRAN: pasan a ser control, no cifra. Sirven para detectar
// el día que Binance se despegue del resto del mercado, que es justo cuando
// publicar su número sin mirar nada más sería un error.
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
// dueño guarda un fiado y la tasa está vieja, y ahí `ensure-fresh` lo mete en
// un `Promise.race` contra 2,5 s. Con 8 s, un mal día de CriptoYa haría
// perder esa carrera al refresco entero y el fiado se sellaría con una tasa
// vieja, en silencio. Con 2 s no puede ser nunca la causa.
const TIMEOUT_MS = 2_000;

// A partir de aquí, Binance y el resto del mercado no están contando la misma
// historia. No invalida el dato —puede ser real— pero tiene que verse en el
// log, porque es la única señal de que la casa de referencia se despegó.
const DESVIO_SOSPECHOSO = 0.03;

// EL LÍMITE DE CORDURA, y no es paranoia.
//
// Hasta ahora lo único que se comprobaba era `ask > 0`. Eso deja pasar un
// 9.670.000 por un punto decimal corrido, o por un proveedor que cambie de
// unidad — y Venezuela ha redenominado el bolívar TRES veces, así que un
// cambio de unidad en una fuente de tasas no es un escenario inventado.
//
// El USDT vale aproximadamente un dólar, así que su precio en bolívares tiene
// que parecerse al de la tasa oficial. La banda es ancha a propósito: el
// paralelo ha llegado a estar un 60 % por encima del oficial en Venezuela, y
// un filtro estrecho tiraría datos buenos en la próxima crisis. Lo que corta
// es un número de otro orden de magnitud, que es lo que de verdad hace daño.
const BANDA_MINIMA = 0.5; // medio dólar oficial
const BANDA_MAXIMA = 5; // cinco veces el oficial

type Casa = { ask?: number; bid?: number; time?: number };

export type UsdtP2p = {
  // Binance P2P. Estos dos son EL dato.
  ask: number;
  bid: number;
  // Cuántos segundos tiene la cotización de Binance según CriptoYa. Un
  // número correcto pero de hace seis horas es un número equivocado, y sin
  // esto no habría forma de distinguirlos.
  edadSegundos: number | null;
  // ── De aquí abajo, control. Nunca se publica. ──
  // La mediana de las demás casas, solo para comparar.
  resto: number | null;
  // Cuánto se separa Binance del resto, en tanto por uno.
  desvio: number | null;
  casasComparadas: number;
};

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? (ordenados[medio - 1] + ordenados[medio]) / 2
    : ordenados[medio];
}

// Nunca lanza. Igual que `fetchPrevista`: esto es un extra sobre la tasa que
// sí rige, y que falle no puede impedir que se guarde la tasa oficial del día.
export async function fetchUsdtP2p(oficialUsd?: number): Promise<UsdtP2p | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://criptoya.com/api/usdt/ves/1", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`criptoya respondió ${res.status}`);

    const data = (await res.json()) as Record<string, Casa>;
    const binance = data.binancep2p;

    // Sin Binance no hay dato. No se sustituye por otra casa ni por la
    // mediana del resto: eso sería volver a publicar un número que no es el
    // que el dueño va a comprobar. Si falta, falta — y el log lo dice, que es
    // justo lo que la fase 1 está midiendo.
    if (!binance?.ask || !binance?.bid) {
      throw new Error("criptoya respondió sin binancep2p");
    }

    // Fuera de banda: se descarta y se deja constancia. Enseñar un precio de
    // otro orden de magnitud es peor que no enseñar ninguno — la pestaña
    // desaparece y la calculadora sigue con dólar y euro.
    if (oficialUsd && (binance.ask < oficialUsd * BANDA_MINIMA || binance.ask > oficialUsd * BANDA_MAXIMA)) {
      throw new Error(
        `precio fuera de banda: ${binance.ask} contra un oficial de ${oficialUsd}`,
      );
    }

    // El control: las demás casas, descartando la que falte o venga en cero.
    const otras = Object.entries(data)
      .filter(([nombre]) => nombre !== "binancep2p")
      .map(([, casa]) => casa.ask)
      .filter((n): n is number => typeof n === "number" && n > 0);

    const resto = otras.length >= 3 ? mediana(otras) : null;
    const desvio = resto ? (binance.ask - resto) / resto : null;

    return {
      ask: binance.ask,
      bid: binance.bid,
      edadSegundos: binance.time ? Math.round(Date.now() / 1000 - binance.time) : null,
      resto,
      desvio,
      casasComparadas: otras.length,
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

// La línea del log. Vive aquí y no en `fetch-and-store` para que el formato
// esté al lado de lo que lo produce: la fase 1 se mide leyendo estas líneas,
// así que son la salida real de este archivo, no un detalle de depuración.
export function lineaDeLog(usdt: UsdtP2p | null, oficial: number): string {
  if (!usdt) return "[usdt] sin dato hoy";

  const partes = [
    `venta ${usdt.ask}`,
    `compra ${usdt.bid}`,
    usdt.edadSegundos !== null ? `${usdt.edadSegundos}s de antigüedad` : "sin marca de tiempo",
    `oficial ${oficial}`,
  ];

  if (usdt.desvio !== null && usdt.resto !== null) {
    const pct = (usdt.desvio * 100).toFixed(2);
    const alarma = Math.abs(usdt.desvio) > DESVIO_SOSPECHOSO ? " ⚠ DESPEGADO" : "";
    partes.push(`resto del mercado ${usdt.resto} (${pct}%, ${usdt.casasComparadas} casas)${alarma}`);
  }

  return `[usdt] Binance P2P · ${partes.join(" · ")}`;
}
