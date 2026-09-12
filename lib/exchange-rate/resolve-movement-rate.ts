import type { createClient } from "@/lib/supabase/server";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
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
export type MovementRateResolution =
  | { ok: true; snapshot: MovementRateSnapshot }
  | { ok: false; error: string };

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
): Promise<MovementRateResolution> {
  const resultado = await getOwnerRateContextResult(supabase, ownerId);

  // Dueño colombiano: currency null es la respuesta, no una ausencia. Lo que
  // mande el formulario da igual — un negocio CO no tiene libro en dólares.
  if (resultado.kind === "co") {
    return { ok: true, snapshot: SIN_TASA };
  }

  // Venezolano sin moneda. No se inventa: se rechaza y lo ve el dueño.
  if (!currency) {
    return {
      ok: false,
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
  const effectiveForCurrency = currency === "USD" ? context.effectiveRate.usd : context.effectiveRate.eur;

  return {
    ok: true,
    snapshot: {
      currency,
      rateModeUsed: context.rateMode,
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
