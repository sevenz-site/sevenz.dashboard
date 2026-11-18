import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllByIds, readAllPages } from "@/lib/supabase/read-all";
import { methodLabel } from "@/lib/payments/methods";

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
 * Reads the month and computes its close WITH THE OWNER'S CLIENT (Reportes, under RLS), with
 * `owner_id` filtered explicitly as well. Every row, not the first 1,000 (PL-34).
 *
 * NOT FOR THE SERVICE ROLE: production revokes its SELECT on these tables, so the Thursday
 * batch reads through `cargarCierreDelMesServidor` below. Both end in `calcularCierre`.
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

  const lineas = filas.map(lineaDesdeFila);
  const devoluciones = devueltas.map((d) => {
    // PostgREST hands the embedded line back as an object or a one-row list.
    const linea = (Array.isArray(d.sale_lines) ? d.sale_lines[0] : d.sale_lines) as
      | { unit_cost: number | string | null }
      | null;
    return devolucionDesdeFila(d, linea?.unit_cost ?? null);
  });

  return calcularCierre(mes, country, lineas, devoluciones);
}

/**
 * The same close FOR THE SERVER (the Thursday batch, as the service role), through
 * `whatsapp_monthly_close_rows` (migration 213): a SECURITY DEFINER function, because in
 * production the service role has no SELECT on `sales`, `sale_lines` or `sale_returns`.
 *
 * The function returns the month's raw rows and nothing computed, so the arithmetic is still
 * `calcularCierre` and the message cannot say something the Reportes card does not.
 * `qa:cierre-mensual` reads one business both ways and compares the two closes.
 */
export async function cargarCierreDelMesServidor(
  service: SupabaseClient,
  ownerId: string,
  country: string | null,
  mes: MesCerrado,
): Promise<CierreDelMes> {
  const { data, error } = await service.rpc("whatsapp_monthly_close_rows", {
    p_owner_id: ownerId,
    p_from: mes.desdeUtc,
    p_to: mes.hastaExclusivoUtc,
  });
  if (error) throw new Error(`whatsapp_monthly_close_rows: ${error.message}`);
  const filas = (data ?? {}) as {
    lineas?: Record<string, unknown>[];
    devoluciones?: Record<string, unknown>[];
  };
  return calcularCierre(
    mes,
    country,
    (filas.lineas ?? []).map(lineaDesdeFila),
    (filas.devoluciones ?? []).map((d) =>
      devolucionDesdeFila(d, (d.unit_cost as number | string | null | undefined) ?? null),
    ),
  );
}

// One reader per row shape, shared by both loaders above, so the two cannot map a column
// differently.
function lineaDesdeFila(l: Record<string, unknown>): LineaDelCierre {
  return {
    saleId: l.sale_id as string,
    currency: l.currency as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
    unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
  };
}

function devolucionDesdeFila(
  d: Record<string, unknown>,
  costoDeSuLinea: number | string | null,
): DevolucionDelCierre {
  return {
    // `sale_returns` spells a Colombian book NULL; `sale_lines` spells it 'COP'.
    currency: (d.currency as string | null) ?? "COP",
    quantity: Number(d.quantity),
    unitPrice: Number(d.unit_price),
    amount: Number(d.amount),
    unitCost: costoDeSuLinea == null ? null : Number(costoDeSuLinea),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// THE CLOSE OF THE DAY — owner's request of 2026-11-17 (frame 2189:28141)
//
// «Cierre del día» is TODAY SO FAR at the business («Hoy hasta ahora», his answer the same
// day): it moves with every sale and says little at eight in the morning, and that is the
// figure he asked for. Same arithmetic as the month (`calcularCierre`, through the same
// loader), so the two cards cannot count a sale or a return differently.
// ═══════════════════════════════════════════════════════════════════════

const MONTHS_SHORT = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];

export type DiaDelNegocio = {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** «17 nov. 2026», the frame's shape («00 sept. 0000»). */
  etiqueta: string;
  /** First instant of the day at the business, UTC. */
  desdeUtc: string;
  /** First instant of the NEXT day at the business, UTC. Never included. */
  hastaExclusivoUtc: string;
};

/** Today at the business, with its bounds in UTC. */
export function hoyDelNegocio(now: Date, country: string | null): DiaDelNegocio {
  const f = fechaLocal(now, country);
  const desde = new Date(Date.UTC(f.year, f.month - 1, f.day) - offsetOf(country) * 3_600_000);
  const hasta = new Date(desde.getTime() + 86_400_000);
  return {
    year: f.year,
    month: f.month,
    day: f.day,
    etiqueta: `${f.day} ${MONTHS_SHORT[f.month - 1]} ${f.year}`,
    desdeUtc: desde.toISOString(),
    hastaExclusivoUtc: hasta.toISOString(),
  };
}

export type CierreDelDia = Omit<CierreDelMes, "mes"> & { dia: DiaDelNegocio };

/** The close of one day, read with the owner's client. See `cargarCierreDelMes`. */
export async function cargarCierreDelDia(
  supabase: SupabaseClient,
  ownerId: string,
  country: string | null,
  dia: DiaDelNegocio,
): Promise<CierreDelDia> {
  // The loader only reads the bounds; the month fields are filled so the type holds.
  const { mes: _mes, ...resto } = await cargarCierreDelMes(supabase, ownerId, country, {
    year: dia.year,
    month: dia.month,
    monthName: MONTHS[dia.month - 1],
    desdeUtc: dia.desdeUtc,
    hastaExclusivoUtc: dia.hastaExclusivoUtc,
  });
  void _mes;
  return { ...resto, dia };
}

// ── THE DAY'S TRANSACTIONS, ONE ROW EACH («Por venta», his answer of 2026-11-17) ────────────
//
// What «Ver todo» opens. One row per sale AND book, the way the card counts them (a sale paid
// in dollars and euros is one in each book). Since his second answer the same day it holds
// EVERY transaction of the day, like the card's breakdown: «Ventas registradas … deben incluir
// todas las transacciones porque es el comportamiento del día». So the abonos (one row per
// payment, a split abono being one payment) and the fiados written without a sale are rows
// too, next to the sales and the returns.

export type FilaDelDia = {
  /** `sale:<id>:<book>` or `return:<id>`. */
  clave: string;
  /** ISO instant, for the hour. */
  cuando: string;
  cliente: string;
  tipo: "De contado" | "Fiado" | "Devolución" | "Abono";
  /** «Aceite vegetal 1 L ×1, Arroz ×2». */
  detalle: string;
  libro: CierreLedger;
  /** Negative for a return. */
  total: number;
  href: string;
};

export async function cargarVentasDelDia(
  supabase: SupabaseClient,
  ownerId: string,
  country: string | null,
  dia: DiaDelNegocio,
): Promise<FilaDelDia[]> {
  const books = ledgersOfCountry(country);
  const ventas = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("sales")
      .select("id, created_at, clients(name, is_walk_in)", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", dia.desdeUtc)
      .lt("created_at", dia.hastaExclusivoUtc)
      .order("id")
      .range(from, to),
  );
  const ids = ventas.map((v) => v.id as string);
  const [lineas, cargos] = ids.length
    ? await Promise.all([
        readAllByIds<Record<string, unknown>>(ids, (batch, from, to) =>
          supabase
            .from("sale_lines")
            .select("id, sale_id, name, quantity, unit_price, currency", { count: "exact" })
            .in("sale_id", batch)
            .order("id")
            .range(from, to),
        ),
        readAllByIds<Record<string, unknown>>(ids, (batch, from, to) =>
          supabase
            .from("movements")
            .select("id, sale_id, currency", { count: "exact" })
            .eq("type", "charge")
            .is("deleted_at", null)
            .in("sale_id", batch)
            .order("id")
            .range(from, to),
        ),
      ])
    : [[], []];

  const nombre = (c: unknown) => {
    const cl = (Array.isArray(c) ? c[0] : c) as { name?: string; is_walk_in?: boolean } | null;
    return cl?.is_walk_in ? "Mostrador" : (cl?.name ?? "Cliente");
  };
  const cantidad = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","));

  const filas: FilaDelDia[] = [];
  for (const v of ventas) {
    const suyas = lineas.filter((l) => l.sale_id === v.id);
    for (const libro of books) {
      const delLibro = suyas.filter((l) => l.currency === libro);
      if (!delLibro.length) continue;
      // `movements` spells the Colombian book NULL; `sale_lines` spells it 'COP'.
      const cargo = cargos.find((c) => c.sale_id === v.id && ((c.currency as string | null) ?? "COP") === libro);
      filas.push({
        clave: `sale:${v.id}:${libro}`,
        cuando: v.created_at as string,
        cliente: nombre(v.clients),
        tipo: cargo ? "Fiado" : "De contado",
        detalle: delLibro.map((l) => `${l.name} ×${cantidad(Number(l.quantity))}`).join(", "),
        libro,
        total: round2(delLibro.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0)),
        href: cargo ? `/transacciones/${cargo.id}` : `/transacciones/venta/${v.id}/${libro.toLowerCase()}`,
      });
    }
  }

  const devueltas = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("sale_returns")
      .select("id, created_at, product_name, quantity, amount, currency, clients(name, is_walk_in)", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", dia.desdeUtc)
      .lt("created_at", dia.hastaExclusivoUtc)
      .order("id")
      .range(from, to),
  );
  // A return's detail is its `movements` row, keyed by `payment_group_id` (migration 185).
  const suyos = devueltas.length
    ? await readAllByIds<Record<string, unknown>>(
        devueltas.map((d) => d.id as string),
        (batch, from, to) =>
          supabase
            .from("movements")
            .select("id, payment_group_id", { count: "exact" })
            .eq("type", "return")
            .in("payment_group_id", batch)
            .order("id")
            .range(from, to),
      )
    : [];
  for (const d of devueltas) {
    const libro = ((d.currency as string | null) ?? "COP") as CierreLedger;
    if (!books.includes(libro)) continue;
    const mov = suyos.find((m) => m.payment_group_id === d.id);
    filas.push({
      clave: `return:${d.id}`,
      cuando: d.created_at as string,
      cliente: nombre(d.clients),
      tipo: "Devolución",
      detalle: `${d.product_name} ×${cantidad(Number(d.quantity))}`,
      libro,
      total: -round2(Number(d.amount)),
      href: mov ? `/transacciones/${mov.id}` : "/reportes",
    });
  }

  // ── ABONOS AND FIADOS WITHOUT A SALE ─────────────────────────────────────────────────────
  // `movements` carries no `owner_id`: the owner is reached through its client (`!inner`), on
  // top of RLS, the explicit check CLAUDE.md asks for.
  const movimientos = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("movements")
      .select(
        "id, type, amount, currency, created_at, sale_id, payment_group_id, paid_with_credit, payment_method, description, clients!inner(name, is_walk_in, owner_id)",
        { count: "exact" },
      )
      .eq("clients.owner_id", ownerId)
      .in("type", ["payment", "charge"])
      .is("deleted_at", null)
      .gte("created_at", dia.desdeUtc)
      .lt("created_at", dia.hastaExclusivoUtc)
      .order("id")
      .range(from, to),
  );
  // A split abono writes one line per fiado with the same `payment_group_id`: one payment,
  // one row, its lines added up.
  const abonos = new Map<string, FilaDelDia>();
  for (const m of movimientos) {
    const libro = ((m.currency as string | null) ?? "COP") as CierreLedger;
    if (!books.includes(libro)) continue;
    if (m.type === "payment") {
      const clave = `payment:${(m.payment_group_id as string | null) ?? m.id}:${libro}`;
      const previa = abonos.get(clave);
      if (previa) {
        previa.total = round2(previa.total + Number(m.amount));
        continue;
      }
      abonos.set(clave, {
        clave,
        cuando: m.created_at as string,
        cliente: nombre(m.clients),
        tipo: "Abono",
        // Its payment method when it has one (migration 214), the line the row would otherwise
        // spend repeating «Abono».
        detalle:
          methodLabel(m.payment_method as string | null, libro) ?? ((m.description as string | null)?.trim() || "Abono"),
        libro,
        total: round2(Number(m.amount)),
        href: `/transacciones/${m.id}`,
      });
    } else if (m.type === "charge" && !m.sale_id && !m.paid_with_credit) {
      // A fiado born from a sale is already its sale's row; this is the one written by hand
      // (or an old debt), the rest of what «Fiados» counts.
      filas.push({
        clave: `charge:${m.id}`,
        cuando: m.created_at as string,
        cliente: nombre(m.clients),
        tipo: "Fiado",
        detalle: (m.description as string | null)?.trim() || "Fiado",
        libro,
        total: round2(Number(m.amount)),
        href: `/transacciones/${m.id}`,
      });
    }
  }
  filas.push(...abonos.values());

  // Newest first, like every history in the app.
  return filas.sort((a, b) => (a.cuando < b.cuando ? 1 : a.cuando > b.cuando ? -1 : 0));
}
