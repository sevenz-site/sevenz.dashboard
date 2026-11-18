import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllByIds, readAllPages } from "@/lib/supabase/read-all";
import { documento, fila, importe } from "@/lib/reports/csv";
import type { Exportacion } from "@/lib/reports/exportar-movimientos";
import { cargarFacturacion, type Facturacion } from "@/lib/reports/facturacion";
import {
  cargarCierreDelDia,
  cargarCierreDelMes,
  cargarVentasDelDia,
  hoyDelNegocio,
  ledgersOfCountry,
  ultimoMesCerrado,
  type CierreLedger,
  type LibroDelCierre,
} from "@/lib/reports/cierre-del-mes";

// THE TWO CLOSES AS A FILE — owner's request of 2026-11-17: «Descargar» on the month card and,
// for both, in the header's «Descargar» options. «Excel, como el de hoy», his answer to the
// format: the same semicolon CSV with a BOM that `/api/reportes/movimientos` writes, which Excel
// opens in es-VE and es-CO (see `lib/reports/csv.ts`).
//
// THE SAME FIGURES AS THE CARDS, from the same loaders (`cargarCierreDelDia`,
// `cargarCierreDelMes`), so a file cannot disagree with the screen it was downloaded from, nor
// the month with the `cierre_mensual` WhatsApp.
//
// UNDER THE SUMMARY, THE DETAIL. The day lists its sales one row per sale and book, as «Ver
// todo» does. The month lists what was sold per product, because a month of rows per sale is a
// file nobody reads; returns of the month come off their product.

const NOMBRE: Record<CierreLedger, string> = { USD: "Dólares", EUR: "Euros", COP: "Pesos" };

function resumen(
  libros: Partial<Record<CierreLedger, LibroDelCierre>>,
  country: string | null,
  lineasSinCosto: number,
  desglose: Facturacion,
): string[] {
  const out = [fila(["Moneda", "Total vendido", "Ventas", "Ganancia estimada"])];
  for (const l of ledgersOfCountry(country)) {
    const b = libros[l];
    if (!b || b.ventas === 0) continue;
    // No line with a cost: the profit is unknown, not zero («Vacío no es cero», CLAUDE.md).
    out.push(fila([NOMBRE[l], importe(b.vendido), b.ventas, b.conCosto === 0 ? "—" : importe(b.ganancia)]));
  }
  if (out.length === 1) out.push(fila(["Sin ventas"]));
  // THE FOUR TYPES, as on the card (owner's request of 2026-11-17): the Facturación cards'
  // arithmetic over the close's span. Amounts positive in their own column: a «-» cell is
  // escaped into text by the CSV's formula guard.
  out.push("");
  out.push(fila(["Moneda", "Tipo", "Cantidad", "Monto"]));
  const tipos = [
    ["De contado", "contado", "ventas"],
    ["Abonos", "abono", "abonos"],
    ["Fiados", "fiado", "fiados"],
    ["Devoluciones", "devolucion", "devoluciones"],
  ] as const;
  for (const l of ledgersOfCountry(country)) {
    for (const [rotulo, clave, monto] of tipos) {
      const cuenta = desglose.recuentos[l]?.[clave] ?? 0;
      const valor = Number(desglose[monto][l] ?? 0);
      out.push(fila([NOMBRE[l], rotulo, cuenta, importe(Math.abs(valor))]));
    }
  }
  out.push("");
  out.push(fila(["Productos vendidos sin costo", lineasSinCosto]));
  out.push(fila(["No entran en la ganancia."]));
  return out;
}

export async function exportarCierre({
  supabase,
  ownerId,
  country,
  nombreDelNegocio,
  que,
  ahora = new Date(),
}: {
  supabase: SupabaseClient;
  ownerId: string;
  country: string | null;
  nombreDelNegocio: string;
  que: "dia" | "mes";
  ahora?: Date;
}): Promise<Exportacion> {
  if (que === "dia") {
    const hoy = hoyDelNegocio(ahora, country);
    const [cierre, ventas, desglose] = await Promise.all([
      cargarCierreDelDia(supabase, ownerId, country, hoy),
      cargarVentasDelDia(supabase, ownerId, country, hoy),
      desgloseDe(supabase, ownerId, country, hoy.desdeUtc, hoy.hastaExclusivoUtc),
    ]);
    const lineas = [
      fila(["Cierre del día", hoy.etiqueta]),
      fila(["Negocio", nombreDelNegocio]),
      fila(["Lo que va del día. Ya descuenta las devoluciones."]),
      "",
      ...resumen(cierre.libros, country, cierre.lineasSinCosto, desglose),
      "",
      // RETURNS IN THEIR OWN COLUMN, POSITIVE. A «-3,80» cell is escaped as «'-3,80» by the
      // CSV's formula guard (`lib/reports/csv.ts`), and Excel then reads it as text and leaves it
      // out of a sum. «Vendido» minus «Devuelto» is the card's «Ventas registradas».
      fila(["Hora", "Tipo", "Cliente", "Detalle", "Moneda", "Monto", "Devuelto"]),
      ...ventas.map((v) =>
        fila([
          new Date(v.cuando).toLocaleTimeString("es-VE", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: country === "CO" ? "America/Bogota" : "America/Caracas",
          }),
          v.tipo,
          v.cliente,
          v.detalle,
          NOMBRE[v.libro],
          v.total >= 0 ? importe(v.total) : "",
          v.total < 0 ? importe(-v.total) : "",
        ]),
      ),
    ];
    const n = `${hoy.year}-${String(hoy.month).padStart(2, "0")}-${String(hoy.day).padStart(2, "0")}`;
    return { csv: documento(lineas), nombre: `cierre-del-dia-${n}`, filas: ventas.length };
  }

  const mes = ultimoMesCerrado(ahora, country);
  const [cierre, desglose] = await Promise.all([
    cargarCierreDelMes(supabase, ownerId, country, mes),
    desgloseDe(supabase, ownerId, country, mes.desdeUtc, mes.hastaExclusivoUtc),
  ]);
  const productos = await productosDelPeriodo(supabase, ownerId, country, mes.desdeUtc, mes.hastaExclusivoUtc);
  const lineas = [
    fila(["Cierre de " + mes.monthName, String(mes.year)]),
    fila(["Negocio", nombreDelNegocio]),
    fila(["El mes completo. Ya descuenta las devoluciones."]),
    "",
    ...resumen(cierre.libros, country, cierre.lineasSinCosto, desglose),
    "",
    // NET OF THE MONTH'S RETURNS, per product. A product returned more than it sold in the
    // month (a sale of September given back in October) would come out negative and be escaped
    // into text (see the day's columns above), so its row says so in words and keeps the cell
    // a number: the absolute value, under «Devuelto».
    fila(["Producto", "Moneda", "Cantidad", "Vendido", "Devuelto"]),
    ...productos.map((p) =>
      p.vendido >= 0
        ? fila([p.nombre, NOMBRE[p.libro], p.cantidad, importe(p.vendido), ""])
        : fila([p.nombre, NOMBRE[p.libro], Math.abs(p.cantidad), "", importe(-p.vendido)]),
    ),
  ];
  return {
    csv: documento(lineas),
    nombre: `cierre-de-${mes.monthName}-${mes.year}`,
    filas: productos.length,
  };
}

/** The four types over a span: the Facturación cards' arithmetic, as the screen's close uses. */
function desgloseDe(supabase: SupabaseClient, ownerId: string, country: string | null, desde: string, hasta: string) {
  return cargarFacturacion({
    supabase,
    ownerId,
    rango: { desde: new Date(desde), hasta: new Date(new Date(hasta).getTime() - 1) },
    dosLibros: country === "VE",
    soloTransacciones: true,
  });
}

/** What was sold per product and book in a span, minus what came back in it. */
async function productosDelPeriodo(
  supabase: SupabaseClient,
  ownerId: string,
  country: string | null,
  desde: string,
  hasta: string,
): Promise<{ nombre: string; libro: CierreLedger; cantidad: number; vendido: number }[]> {
  const books = ledgersOfCountry(country);
  const ventas = await readAllPages<{ id: string }>((from, to) =>
    supabase
      .from("sales")
      .select("id", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", desde)
      .lt("created_at", hasta)
      .order("id")
      .range(from, to),
  );
  const lineas = ventas.length
    ? await readAllByIds<Record<string, unknown>>(
        ventas.map((v) => v.id),
        (batch, from, to) =>
          supabase
            .from("sale_lines")
            .select("id, name, quantity, unit_price, currency", { count: "exact" })
            .in("sale_id", batch)
            .order("id")
            .range(from, to),
      )
    : [];
  const devueltas = await readAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("sale_returns")
      .select("id, product_name, quantity, amount, currency", { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", desde)
      .lt("created_at", hasta)
      .order("id")
      .range(from, to),
  );

  const acc = new Map<string, { nombre: string; libro: CierreLedger; cantidad: number; vendido: number }>();
  const sumar = (nombre: string, libro: string, cantidad: number, vendido: number) => {
    if (!books.includes(libro as CierreLedger)) return;
    const k = `${libro}|${nombre}`;
    const p = acc.get(k) ?? { nombre, libro: libro as CierreLedger, cantidad: 0, vendido: 0 };
    p.cantidad += cantidad;
    p.vendido += vendido;
    acc.set(k, p);
  };
  for (const l of lineas) {
    sumar(l.name as string, l.currency as string, Number(l.quantity), Number(l.quantity) * Number(l.unit_price));
  }
  // `sale_returns` spells a Colombian book NULL; `sale_lines` spells it 'COP'.
  for (const d of devueltas) {
    sumar(d.product_name as string, (d.currency as string | null) ?? "COP", -Number(d.quantity), -Number(d.amount));
  }
  return [...acc.values()]
    .map((p) => ({ ...p, cantidad: Math.round(p.cantidad * 1000) / 1000, vendido: Math.round(p.vendido * 100) / 100 }))
    .sort((a, b) => b.vendido - a.vendido);
}
