import type { createClient } from "@/lib/supabase/server";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { todayInCaracas } from "@/lib/exchange-rate/rate-status";
import type { LedgerCurrency } from "@/lib/types";

export type MovementLedger = { currency: LedgerCurrency | null; rate: { usd: number; eur: number } | null };

export type MovementRateSnapshot = {
  currency: LedgerCurrency | null;
  rateModeUsed: string | null;
  exchangeRateUsed: number | null;
  officialBcvRateAtTime: number | null;
  entryCurrency: LedgerCurrency | null;
  rateUsdAtTime: number | null;
  rateEurAtTime: number | null;
  ledger: MovementLedger | null;
};

// Falla en vez de acertar por casualidad. El único motivo de rechazo es que el
// dueño sea venezolano y no venga moneda: ahí no hay respuesta correcta que
// deducir, solo dos libros distintos entre los que elegir a ciegas.
export type MovementRejectionReason = "ve_sin_moneda" | "pais_desconocido";

export type MovementRateResolution =
  | { ok: true; snapshot: MovementRateSnapshot }
  // `reason` va aparte del mensaje para que quien anota la telemetría no tenga
  // que reconocer el rechazo por el texto: el mensaje está escrito para el
  // dueño y cambiará cuando se lea mal, el motivo es para nosotros y no.
  | { ok: false; reason: MovementRejectionReason; error: string };

const SIN_TASA: MovementRateSnapshot = {
  currency: null,
  rateModeUsed: null,
  exchangeRateUsed: null,
  officialBcvRateAtTime: null,
  entryCurrency: null,
  rateUsdAtTime: null,
  rateEurAtTime: null,
  ledger: null,
};

// Resolves the rate snapshot for a movement. No conversion happens here —
// USD/EUR amounts are stored exactly as typed, since $50 and €20 are two
// independent debts, not one debt seen two ways.
//
// Lo usan las tres rutas que escriben en movements: alta manual, alta con
// cliente nuevo, y la confirmación del import por foto. Es el único sitio por
// el que pasa la moneda de un movimiento, y por eso el invariante vive aquí.
//
// ANTES ADIVINABA. La versión anterior hacía `currency ?? DEFAULT_LEDGER_CURRENCY`
// para un dueño VE, eligiendo dólares cuando el formulario no mandaba nada. No
// era un descuido: era el arreglo de un fallo anterior, en el que esa misma
// ausencia caía en el libro COP. Se cambió una suposición silenciosa por otra
// menos mala, pero seguía siendo una suposición sobre el dinero de alguien.
//
// Un valor por defecto en el formulario es una sugerencia que el dueño ve y
// puede cambiar. El mismo valor por defecto en el servidor es una apuesta que
// nadie ve. Por eso DEFAULT_LEDGER_CURRENCY sigue vivo en el radio de la
// interfaz y ha desaparecido de aquí.
export async function resolveMovementRateSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  currency: LedgerCurrency | null,
  // El dueño marcó "aplicar la tasa prevista". Es una CASILLA, no una cifra: el
  // navegador no manda ningún número, solo pide que se use la tasa que el
  // servidor ya tiene guardada. Si mandara el número, una petición hecha a mano
  // podría sellar cualquier cosa en el respaldo de un movimiento.
  //
  // Y se ignora sin ruido si no hay prevista o si ya entró en vigor: en ese caso
  // la tasa correcta es la vigente, que es lo que se sella.
  usarPrevista = false,
): Promise<MovementRateResolution> {
  const resultado = await getOwnerRateContextResult(supabase, ownerId);

  // No sabemos el país, así que no sabemos el libro. Se rechaza en vez de
  // suponer: suponer "es CO" aquí escribiría el fiado de un venezolano en el
  // libro colombiano, que es el fallo entero que este archivo previene.
  if (resultado.kind === "pais_desconocido") {
    return {
      ok: false,
      reason: "pais_desconocido",
      error: "No pudimos leer los datos de tu negocio. Vuelve a intentarlo en un momento.",
    };
  }

  // Dueño colombiano: currency null es la respuesta, no una ausencia. Lo que
  // mande el formulario da igual — un negocio CO no tiene libro en dólares.
  if (resultado.kind === "co") {
    return { ok: true, snapshot: SIN_TASA };
  }

  // Venezolano sin moneda. No se inventa: se rechaza y lo ve el dueño.
  if (!currency) {
    return {
      ok: false,
      reason: "ve_sin_moneda",
      error: "No pudimos saber si el movimiento es en dólares o en euros. Vuelve a intentarlo eligiendo la moneda.",
    };
  }

  // Venezolano, con moneda, pero sin tasa guardada — el BCV nunca se ha
  // consultado en este entorno, o la consulta falló ahorita.
  //
  // Se escribe igual. La moneda la sabemos porque el dueño la eligió, y es lo
  // que decide en qué libro entra la deuda; la tasa solo alimenta las columnas
  // de auditoría y el equivalente en bolívares. Bloquear el fiado por no poder
  // sellar una tasa convertiría una caída pasajera del BCV en una caja que no
  // puede vender.
  if (resultado.kind === "ve_sin_tasa") {
    return {
      ok: true,
      snapshot: { ...SIN_TASA, currency, entryCurrency: currency, ledger: { currency, rate: null } },
    };
  }

  const { context } = resultado;
  const officialForCurrency = currency === "USD" ? context.officialRate.usd : context.officialRate.eur;

  // La prevista solo aplica mientras siga siendo futura. Se compara contra hoy
  // en Caracas y no contra la hora del servidor: Vercel corre en UTC y a las
  // ocho de la noche hora de Venezuela ya cree que es mañana, lo que apagaría
  // la prevista media tarde antes de tiempo.
  const prevista =
    usarPrevista && context.prevista && context.prevista.fecha > todayInCaracas()
      ? context.prevista
      : null;

  const effectiveForCurrency = prevista
    ? currency === "USD"
      ? prevista.usd
      : prevista.eur
    : currency === "USD"
      ? context.effectiveRate.usd
      : context.effectiveRate.eur;

  return {
    ok: true,
    snapshot: {
      currency,
      // Su propio modo, ni BCV_AUTO ni CUSTOM. Dentro de un mes, mirando el
      // respaldo de un movimiento, la diferencia entre "usó una tasa que aún no
      // regía" y "se inventó un número" es toda la diferencia.
      rateModeUsed: prevista ? "BCV_PREVISTA" : context.rateMode,
      exchangeRateUsed: effectiveForCurrency,
      officialBcvRateAtTime: officialForCurrency,
      // entry_currency/entry_amount mirror currency/amount now that nothing
      // gets converted at write time — kept so the movement detail's existing
      // "what was typed" rows keep working unchanged.
      entryCurrency: currency,
      rateUsdAtTime: context.effectiveRate.usd,
      rateEurAtTime: context.effectiveRate.eur,
      ledger: { currency, rate: context.effectiveRate },
    },
  };
}
