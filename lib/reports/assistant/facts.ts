import type { createClient } from "@/lib/supabase/server";
import type { BolivarRates } from "@/lib/products/price";
import type { EffectiveRate } from "@/lib/exchange-rate/convert";
import type { Rango } from "@/lib/reports/rango";
import { cargarFacturacion, type Libro } from "@/lib/reports/facturacion";
import { cargarInventario } from "@/lib/reports/inventario";
import { cargarProveedores } from "@/lib/reports/proveedores";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ═══════════════════════════════════════════════════════════════════════
// THE FACTS THE ASSISTANT IS ALLOWED TO SEE
//
// The owner asked on 2026-10-29 for a summary of all three Reportes tabs. This
// is the only thing that ever reaches the model, and the whole file exists to
// answer two questions: what is true, and what may leave the building.
//
// ───────────────────────────────────────────────────────────────────────
// IT CALLS THE REAL LOADERS, AND THAT IS THE POINT
//
// `cargarFacturacion`, `cargarInventario` and `cargarProveedores` are the same
// functions that paint the three tabs. Going through them costs about twenty
// Supabase round trips, which is exactly why `/reportes` refuses to load more
// than one tab per render -- its own comment says *«traer los datos de los tres
// para enseñar uno es pagar tres consultas por pantalla»*.
//
// What makes it affordable here is the owner's own design decision the same
// day: *«la idea es que ese insight se regenere una vez por día»*. Twenty round
// trips once a day per shop is nothing. Twenty per page load would be the
// screen's design undone.
//
// And it buys the one thing a cheaper hand-written query could not: the
// assistant CANNOT quote a figure different from the one its tab shows,
// because it is reading the same function. This repo has paid twice for the
// other arrangement -- `lib/share-balance.ts` and `CT-124`, where the ledger
// and the credit score drifted for months and credited on-time payments to
// debts nobody had paid.
//
// ───────────────────────────────────────────────────────────────────────
// NOT ONE NAME LEAVES. OF ANYTHING.
//
// Owner's instruction, 2026-10-29: *«tampoco se le envía información personal
// de dueños, negocios o clientes»*. Taken to its end, that rules out two fields
// an earlier draft of this feature did intend to send -- product names and
// supplier names -- and the reason is worth keeping:
//
//   · A supplier name plus a handful of product names is a fingerprint.
//     «Makro» + «Bafle azul jbl» + euros + Venezuela is one shop. Without
//     names, what a reviewer sees is orphan numbers.
//   · And this runs on Gemini's FREE tier by the owner's explicit choice,
//     where Google's own terms say it uses submitted content to improve its
//     products and that *«human reviewers may read, annotate, and process your
//     API input and output»*.
//
// The frame is what proves no name is needed: its three example
// recommendations -- WhatsApp reminders to clients whose term is about to
// expire, restocking the best sellers, renegotiating with flagged clients --
// name nobody and nothing. They speak in categories. So does this.
//
// Every list that arrives from a loader is therefore reduced to a COUNT or a
// percentage here, never passed through. `FactsForTheModel` has no `string`
// field that came out of the database by design, and `qa:asistente` asserts
// it against real dev data rather than trusting this paragraph.
// ═══════════════════════════════════════════════════════════════════════

/** How many days back the assistant always looks, whatever the date chip says. */
export const ASSISTANT_WINDOW_DAYS = 7;

/**
 * A client who pays well but has gone quiet. Thirty days is not a number picked
 * here: it is what `ClientStatus.critico` already means elsewhere in the app --
 * owing with no payment for thirty days. Reusing it keeps the assistant from
 * inventing a second definition of "a while".
 */
const DORMANT_DAYS = 30;

export type MoneyByLedger = Partial<Record<Libro, number>>;

export type FactsForTheModel = {
  /** Which ledgers this shop keeps. `["COP"]` is a Colombian one. */
  ledgers: Libro[];
  windowDays: number;

  /** 1 · What is already lent out and may not come back. */
  receivable: MoneyByLedger;
  clients: {
    dueSoon: number;
    overdue: number;
    critical: number;
    flagged: number;
    noTerm: number;
  };

  /** 2 · Whether the till keeps moving. */
  collectedCash: MoneyByLedger;
  collectedOnDebt: MoneyByLedger;
  lent: MoneyByLedger;
  stock: {
    threshold: number;
    available: number;
    runningLow: number;
    outOfStock: number;
    uncounted: number;
    total: number;
    /**
     * Of the six best sellers of the window, how many are at or below the
     * alert threshold. This single number is motivator 2's sharpest signal --
     * the shelf emptying where it matters -- and it is a count precisely so
     * that no product name has to travel.
     */
    bestSellersRunningLow: number;
  };

  /** 3 · Room to sell more. */
  catalogSales: MoneyByLedger;
  unhandledOrders: number;
  suppliers: {
    total: number;
    withComputableMargin: number;
    lowestMarginPct: number | null;
    highestMarginPct: number | null;
  };

  /** 4 · Good clients going quiet. */
  dormantGoodPayers: number;

  /**
   * How much of the above is guesswork. These go into the summary as a caveat
   * on confidence, NEVER as a recommendation: the Inventario tab already warns
   * about both, two inches below the banner, and repeating it there would be
   * the assistant reading the screen back to its reader.
   */
  gaps: { productsWithoutCost: number; productsUncounted: number; unattributedSaleLines: number };

  /** Nothing has ever been registered. The caller must not call the model at all. */
  empty: boolean;
};

/** The fixed window, ending now. */
export function assistantWindow(now: Date = new Date()): Rango {
  const hasta = new Date(now);
  hasta.setHours(23, 59, 59, 999);
  const desde = new Date(now);
  desde.setDate(desde.getDate() - (ASSISTANT_WINDOW_DAYS - 1));
  desde.setHours(0, 0, 0, 0);
  return { desde, hasta };
}

export async function buildFacts({
  supabase,
  ownerId,
  dosLibros,
  effectiveRate,
  rates,
  now = new Date(),
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  /** `true` for a Venezuelan shop, which keeps two ledgers. */
  dosLibros: boolean;
  effectiveRate: EffectiveRate | null;
  rates: BolivarRates | null;
  now?: Date;
}): Promise<FactsForTheModel> {
  const rango = assistantWindow(now);

  // IN PARALLEL. They share no state and the slowest one sets the floor; run
  // in sequence this would be three waves of waiting for no reason.
  const [facturacion, inventario, proveedores] = await Promise.all([
    cargarFacturacion({ supabase, ownerId, rango, dosLibros, effectiveRate }),
    cargarInventario({ supabase, ownerId, rango, rates }),
    cargarProveedores({ supabase, ownerId, rango, rates }),
  ]);

  // ── THE BEST SELLERS THAT ARE RUNNING OUT ──────────────────────────
  // The crossing is done HERE and reduced to a count. `masVendidos` carries
  // names and ids; what leaves is how many of them are low.
  const lowIds = new Set(inventario.porAgotarseLista.map((p) => p.id));
  const bestSellersRunningLow = inventario.masVendidos.filter((p) => lowIds.has(p.id)).length;

  // ── SUPPLIER MARGINS, WITHOUT THE SUPPLIERS ────────────────────────
  // `margenPct` is null -- never 0 -- for a supplier whose products did not
  // sell in the window, so those are excluded rather than counted as zero
  // margin, which would be the page contradicting itself.
  const margins = proveedores
    .map((p) => p.margenPct)
    .filter((m): m is number => m != null);

  return {
    ledgers: facturacion.libros,
    windowDays: ASSISTANT_WINDOW_DAYS,

    receivable: facturacion.porCobrar,
    clients: {
      dueSoon: facturacion.plazos.porVencer,
      overdue: facturacion.plazos.vencido,
      critical: facturacion.plazos.criticos,
      flagged: facturacion.plazos.malasPagas,
      noTerm: facturacion.plazos.sinPlazo,
    },

    collectedCash: facturacion.ventas,
    collectedOnDebt: facturacion.abonos,
    lent: facturacion.fiados,
    stock: {
      threshold: inventario.umbral,
      available: inventario.disponibles,
      runningLow: inventario.porAgotarse,
      outOfStock: inventario.agotadas,
      uncounted: inventario.sinContar,
      total: inventario.totalProductos,
      bestSellersRunningLow,
    },

    catalogSales: facturacion.ventasPorCatalogo,
    unhandledOrders: facturacion.pedidosPorAtender,
    suppliers: {
      total: proveedores.length,
      withComputableMargin: margins.length,
      lowestMarginPct: margins.length ? Math.min(...margins) : null,
      highestMarginPct: margins.length ? Math.max(...margins) : null,
    },

    dormantGoodPayers: await countDormantGoodPayers(supabase, facturacion.mejoresPagadores, now),

    gaps: {
      productsWithoutCost: inventario.sinCosto,
      productsUncounted: inventario.sinContar,
      unattributedSaleLines: inventario.lineasSueltas,
    },

    empty: facturacion.negocioSinNada,
  };
}

/**
 * Motivator 4: a client with a good credit score who has stopped buying.
 *
 * It needs one field no loader returns -- `client_summary.last_movement_at` --
 * so it takes a query of its own. It is bounded to the five ids
 * `mejoresPagadores` already resolved, so it is a five-row lookup, not a scan.
 *
 * `"Sin historial"` tiers are already excluded upstream by `cargarFacturacion`,
 * which is what keeps this from flagging a brand-new client as "gone quiet".
 */
async function countDormantGoodPayers(
  supabase: SupabaseServerClient,
  mejores: { clientId: string }[],
  now: Date,
): Promise<number> {
  if (!mejores.length) return 0;
  const { data, error } = await supabase
    .from("client_summary")
    .select("client_id, last_movement_at")
    .in(
      "client_id",
      mejores.map((m) => m.clientId),
    );
  if (error) {
    // NOT FATAL. One missing motivator is a thinner summary; a thrown error
    // here would take down a banner over a nice-to-have.
    console.error("[assistant/facts] dormantGoodPayers:", error.message);
    return 0;
  }
  const corte = now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000;
  return (data ?? []).filter((r) => {
    const ultimo = r.last_movement_at ? new Date(r.last_movement_at as string).getTime() : null;
    return ultimo != null && ultimo < corte;
  }).length;
}
