import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllByIds, readAllPages } from "@/lib/supabase/read-all";

// THE CLOSE OF A MONTH: WHAT WAS SOLD AND WHAT IT LEFT, IN ONE PLACE.
//
// Two faces read it and they must not disagree: the `cierre_mensual` WhatsApp (Thursday
// batch, `lib/whatsapp/business-weekly.ts`) and the «Cierre de …» card in Reportes, which is
// where that message's button lands (owner's approval of the frame, 2026-11-16). Computing it
// in SQL for one and in TypeScript for the other is the trap CLAUDE.md names after CT-124, so
// both call `cargarCierreDelMes` and `calcularCierre`.
//
// THE OWNER'S DECISIONS OF 2026-11-16, before any of this was written:
//   - Returns made during the month are discounted («Descontar devoluciones»), on the day of
//     the return, the convention Reportes already follows (lib/reports/devoluciones.ts). A
//     return can therefore undo a sale of the month before, and that is accepted there too.
//   - The card shows the last CLOSED month whatever range is picked above it, so the figure
//     the button lands on is the one the message said.
//
// AND ONE DECIDED BY THE RULE, NOT BY TASTE: «Una cifra del pasado no se calcula con datos de
// hoy». A line with no frozen `unit_cost` does NOT take today's cost here, unlike the
// per-product figures of Reportes (`cuentasPorProducto` falls back to it for lines older than
// migration 194). It stays out of the profit and is counted in «Productos vendidos sin costo».
// A WhatsApp cannot be corrected, and a month that changed every time a cost was edited is
// the failure of CT-168.

export type CierreLedger = "USD" | "EUR" | "COP";

/** Below this share of lines with a frozen cost, the profit is too partial to send. */
export const MIN_COBERTURA = 0.8;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Fixed offsets: neither Venezuela nor Colombia has daylight saving time, the same premise
// `lib/reports/zona-del-negocio.ts` writes down.
const OFFSET_HOURS: Record<"VE" | "CO", number> = { VE: -4, CO: -5 };

function offsetOf(country: string | null): number {
  return country === "CO" ? OFFSET_HOURS.CO : OFFSET_HOURS.VE;
}

export function ledgersOfCountry(country: string | null): CierreLedger[] {
  return country === "VE" ? ["USD", "EUR"] : ["COP"];
}

export type FechaLocal = { year: number; month: number; day: number; isoDay: number };

/** The calendar date at the business, for an instant. `month` is 1 to 12. */
export function fechaLocal(now: Date, country: string | null): FechaLocal {
  const local = new Date(now.getTime() + offsetOf(country) * 3_600_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    isoDay: local.getUTCDay() || 7,
  };
}

/** The Thursday of the ISO week `now` falls in, at the business. */
export function juevesDeLaSemana(now: Date, country: string | null): FechaLocal {
  const f = fechaLocal(now, country);
  const d = new Date(Date.UTC(f.year, f.month - 1, f.day + (4 - f.isoDay)));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), isoDay: 4 };
}

export type MesCerrado = {
  year: number;
  /** 1 to 12. */
  month: number;
  /** «octubre». Lower case, as the template reads it: «el cierre de octubre». */
  monthName: string;
  /** First instant of the month at the business, UTC. */
  desdeUtc: string;
  /** First instant of the NEXT month at the business, UTC. Never included. */
  hastaExclusivoUtc: string;
};

/** First instant of a local month at the business, in UTC. `month` is 1 to 12. */
export function startOfMonthUtc(year: number, month: number, country: string | null): Date {
  // Midnight at the business is `-offset` hours in UTC.
  return new Date(Date.UTC(year, month - 1, 1) - offsetOf(country) * 3_600_000);
}

/** The month before the given local year and month: the one there is a close of. */
export function mesAnteriorA(year: number, month: number, country: string | null): MesCerrado {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return {
    year: prevYear,
    month: prevMonth,
    monthName: MONTHS[prevMonth - 1],
    desdeUtc: startOfMonthUtc(prevYear, prevMonth, country).toISOString(),
    hastaExclusivoUtc: startOfMonthUtc(year, month, country).toISOString(),
  };
}

/** The last closed month as of `now`, at the business. What the Reportes card shows. */
export function ultimoMesCerrado(now: Date, country: string | null): MesCerrado {
  const f = fechaLocal(now, country);
  return mesAnteriorA(f.year, f.month, country);
}

/** First instant of the month `now` is in, at the business. */
export function inicioDelMesActual(now: Date, country: string | null): string {
  const f = fechaLocal(now, country);
  return startOfMonthUtc(f.year, f.month, country).toISOString();
}

export type LineaDelCierre = {
  saleId: string;
  /** `sale_lines.currency`: 'USD' | 'EUR' | 'COP'. */
  currency: string;
  quantity: number;
  unitPrice: number;
  /** `sale_lines.unit_cost`, frozen at the sale (migration 194). Null when nothing was. */
  unitCost: number | null;
};

export type DevolucionDelCierre = {
  /** Normalised to the `sale_lines` spelling: a Colombian return is 'COP', never null. */
  currency: string;
  quantity: number;
  unitPrice: number;
  /** What came back, as the return stored it. */
  amount: number;
  /** The `unit_cost` of the line it undoes, so it takes back the profit that line added. */
  unitCost: number | null;
};

export type LibroDelCierre = {
  /** Distinct sales with a line in this book. A return does not undo a sale's count. */
  ventas: number;
  /** Σ quantity × price of the month's lines, minus what came back in the month. */
  vendido: number;
  /** Σ (price − frozen cost) × quantity, minus the same for returned lines. */
  ganancia: number;
  /**
   * Lines of this book with a frozen cost. ZERO MEANS THE PROFIT IS UNKNOWN, NOT ZERO: «Vacío
   * no es cero» (CLAUDE.md). The card draws «—» and the WhatsApp leaves the book out of its
   * profit line; a «€0,00» there would be invented. Measured in dev on 2026-11-16: the demo
   * account's October has 123 lines and none with a cost, all older than migration 194.
   */
  conCosto: number;
};

export type CierreDelMes = {
  mes: MesCerrado;
  libros: Partial<Record<CierreLedger, LibroDelCierre>>;
  /** Lines sold in the month, in the business's books. */
  lineas: number;
  /** Of those, the ones with no frozen cost: out of the profit. */
  lineasSinCosto: number;
  /** Lines with a cost reach `MIN_COBERTURA`. Without it, no WhatsApp and a warning on the card. */
  completo: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: no database, so `qa:cierre-mensual` can feed it every edge. */
export function calcularCierre(
  mes: MesCerrado,
  country: string | null,
  lineas: readonly LineaDelCierre[],
  devoluciones: readonly DevolucionDelCierre[],
): CierreDelMes {
  const books = ledgersOfCountry(country);
  const acc = new Map<CierreLedger, { sales: Set<string>; vendido: number; ganancia: number; conCosto: number }>();
  const book = (c: string) => {
    if (!books.includes(c as CierreLedger)) return null;
    let b = acc.get(c as CierreLedger);
    if (!b) acc.set(c as CierreLedger, (b = { sales: new Set(), vendido: 0, ganancia: 0, conCosto: 0 }));
    return b;
  };

  let total = 0;
  let sinCosto = 0;
  for (const l of lineas) {
    const b = book(l.currency);
    if (!b) continue;
    total += 1;
    b.sales.add(l.saleId);
    b.vendido += l.unitPrice * l.quantity;
    if (l.unitCost == null) {
      sinCosto += 1;
      continue;
    }
    b.conCosto += 1;
    b.ganancia += (l.unitPrice - l.unitCost) * l.quantity;
  }
  for (const d of devoluciones) {
    const b = book(d.currency);
    if (!b) continue;
    b.vendido -= d.amount;
    // A returned line with no frozen cost added nothing to the profit, so it takes nothing back.
    if (d.unitCost != null) b.ganancia -= (d.unitPrice - d.unitCost) * d.quantity;
  }

  const libros: CierreDelMes["libros"] = {};
  for (const l of books) {
    const b = acc.get(l);
    if (!b) continue;
    libros[l] = { ventas: b.sales.size, vendido: round2(b.vendido), ganancia: round2(b.ganancia), conCosto: b.conCosto };
  }
  return {
    mes,
    libros,
    lineas: total,
    lineasSinCosto: sinCosto,
    completo: total > 0 && (total - sinCosto) / total >= MIN_COBERTURA,
  };
}

/**
 * Reads the month and computes its close. Works with the owner's client (Reportes, under RLS)
 * and with the service client (the Thursday batch): both filter by `owner_id` explicitly.
 * Every row, not the first 1,000 (PL-34).
 */
export async function cargarCierreDelMes(
  supabase: SupabaseClient,
  ownerId: string,
  country: string | null,
  mes: MesCerrado,
): Promise<CierreDelMes> {
  const ventas = await readAllPages<{ id: string }>((from, to) =>
    supabase
      .from("sales")
      .select("id", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", mes.desdeUtc)
      .lt("created_at", mes.hastaExclusivoUtc)
      .order("id")
      .range(from, to),
  );

  const filas = ventas.length
    ? await readAllByIds<Record<string, unknown>>(
        ventas.map((v) => v.id),
        (batch, from, to) =>
          supabase
            .from("sale_lines")
            .select("id, sale_id, currency, quantity, unit_price, unit_cost", { count: "exact" })
            .in("sale_id", batch)
            .order("id")
            .range(from, to),
      )
    : [];

  const devueltas = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("sale_returns")
      .select("id, currency, quantity, unit_price, amount, sale_lines(unit_cost)", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", mes.desdeUtc)
      .lt("created_at", mes.hastaExclusivoUtc)
      .order("id")
      .range(from, to),
  );

  const lineas: LineaDelCierre[] = filas.map((l) => ({
    saleId: l.sale_id as string,
    currency: l.currency as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
  }));
  const devoluciones: DevolucionDelCierre[] = devueltas.map((d) => {
    // PostgREST hands the embedded line back as an object or a one-row list.
    const linea = (Array.isArray(d.sale_lines) ? d.sale_lines[0] : d.sale_lines) as
      | { unit_cost: number | string | null }
      | null;
    return {
      // `sale_returns` spells a Colombian book NULL; `sale_lines` spells it 'COP'.
      currency: (d.currency as string | null) ?? "COP",
      quantity: Number(d.quantity),
      unitPrice: Number(d.unit_price),
      amount: Number(d.amount),
      unitCost: linea?.unit_cost == null ? null : Number(linea.unit_cost),
    };
  });

  return calcularCierre(mes, country, lineas, devoluciones);
}
