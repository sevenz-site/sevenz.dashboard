import type { LedgerCurrency } from "@/lib/types";
import type { SaleLineRow } from "@/lib/sale-lines";

// UNA VENTA PAGADA ENTERA, para que aparezca en el historial del cliente.
//
// ===========================================================================
// POR QUÉ NO ESTABA, Y POR QUÉ NO SE ARREGLA METIÉNDOLA EN `movements`
//
// Lo reportó el dueño el 2026-10-18: «las transacciones como ventas directas
// no están apareciendo en el historial de movimiento del cliente». Y es
// cierto, y era deliberado: una venta pagada **no escribe nada** en
// `movements` (migración `124`), porque `recalc_client_running_balance` no
// tiene fila neutra — un tipo nuevo se leería como abono y RESTARÍA del saldo.
// Gracias a eso el contado no entra en el puntaje de crédito ni en las
// gráficas de fiado sin filtrarlo en ningún sitio.
//
// Así que la venta no se convierte en movimiento: el historial MEZCLA las dos
// cosas al pintarlas. El saldo, el puntaje y las gráficas siguen leyendo solo
// `movements` y no se enteran de nada.
//
// ===========================================================================
// UNA FILA POR MONEDA, Y SOLO LAS PAGADAS ENTERAS
//
// Las dos cosas las decidió el dueño el 2026-10-18, preguntadas antes de
// construir:
//
//   · UNA FILA POR MONEDA. Una venta puede llevar dólares y euros a la vez, y
//     el historial es por libro: cada fila lleva su bandera y el saldo se
//     lleva por moneda. Una fila con dos monedas no tendría dónde ponerse.
//
//   · SOLO LAS PAGADAS ENTERAS llevan fila de contado. Una venta con parte
//     fiada YA aparece —como su cargo, que es un movimiento de verdad— y
//     añadirle otra fila la enseñaría dos veces. Sus palabras: «una fila por
//     venta con el reparto dentro de lo que pagó y quedó debiendo = es un
//     Fiado; una fila con pago total del monto = es De contado».
export type VentaDeContado = {
  saleId: string;
  createdAt: string;
  // El libro al que entra, con la misma regla que `movements.currency`: `null`
  // es el libro de un negocio colombiano, que es una respuesta y no una
  // ausencia.
  currency: LedgerCurrency | null;
  // Lo cobrado en ESE libro, que en una venta pagada entera es su total.
  amount: number;
  lineas: SaleLineRow[];
};

// Las filas crudas, tal como salen de la base. Se pasan así —y no cada tabla
// por su lado— para que esta función sea pura y se pueda probar sin una
// sesión ni una base delante.
export type VentaCruda = {
  id: string;
  created_at: string;
};
export type PagoCrudo = { sale_id: string; currency: string; amount: number | string };
export type LineaCruda = {
  sale_id: string;
  name: string;
  quantity: number | string;
  unit_price: number | string;
  // LA MONEDA DE LA LÍNEA, que no es un detalle: una venta puede llevar café
  // en dólares y refresco en euros, y cada fila del historial es de UN libro.
  // Sin esto las dos filas decían «Café, Refresco» y cada una afirmaba
  // llevar lo que llevaba la otra. Se vio en pantalla, no leyendo el código.
  currency: string;
};

// `COP` ES EL LIBRO NULO. Es la misma traducción que hace `registrarVenta` con
// `libroDeMoneda`, repetida aquí y no importada de allí porque aquella vive en
// un fichero `"use server"` y traerla arrastraría medio Next a esta función.
function libro(moneda: string): LedgerCurrency | null {
  return moneda === "USD" || moneda === "EUR" ? moneda : null;
}

/**
 * Convierte las ventas de un cliente en filas de historial.
 *
 * `idsConCargo` son las ventas que SÍ dejaron un cargo en `movements` — las
 * que quedaron a crédito, entera o parcialmente. Esas se descartan: ya tienen
 * su fila, y es la del cargo.
 */
export function filasDeContado(
  ventas: VentaCruda[],
  pagos: PagoCrudo[],
  lineas: LineaCruda[],
  idsConCargo: Set<string>,
): VentaDeContado[] {
  const porVenta = new Map<string, VentaCruda>();
  for (const v of ventas) {
    if (!idsConCargo.has(v.id)) porVenta.set(v.id, v);
  }
  if (porVenta.size === 0) return [];

  // Indexadas por (venta, libro), no por venta: ver el comentario de
  // `LineaCruda.currency`.
  const lineasPorVentaYLibro = new Map<string, SaleLineRow[]>();
  for (const l of lineas) {
    if (!porVenta.has(l.sale_id)) continue;
    const clave = `${l.sale_id}|${libro(l.currency) ?? ""}`;
    const lista = lineasPorVentaYLibro.get(clave) ?? [];
    lista.push({
      name: l.name,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
    });
    lineasPorVentaYLibro.set(clave, lista);
  }

  // UNA FILA POR (VENTA, LIBRO). Dos pagos en dólares de la misma venta —uno
  // en efectivo y otro por transferencia, que es corriente— son UNA fila de
  // «De contado» por sus dos importes sumados, no dos filas iguales.
  const sumas = new Map<string, number>();
  for (const p of pagos) {
    if (!porVenta.has(p.sale_id)) continue;
    const clave = `${p.sale_id}|${libro(p.currency) ?? ""}`;
    sumas.set(clave, (sumas.get(clave) ?? 0) + Number(p.amount));
  }

  const filas: VentaDeContado[] = [];
  for (const [clave, amount] of sumas) {
    const [saleId, moneda] = clave.split("|");
    const venta = porVenta.get(saleId);
    if (!venta) continue;
    filas.push({
      saleId,
      createdAt: venta.created_at,
      currency: (moneda || null) as LedgerCurrency | null,
      // Dos decimales, el mismo redondeo que el resto del código de dinero.
      amount: Math.round(amount * 100) / 100,
      lineas: lineasPorVentaYLibro.get(clave) ?? [],
    });
  }

  // MÁS RECIENTE PRIMERO, como el historial, Y LA MONEDA DESEMPATA. Sin lo
  // segundo, las dos filas de una venta en dos libros salen en el orden en que
  // Postgres haya devuelto los pagos: la lista se reordena sola entre recargas
  // y parece que algo cambió.
  return filas.sort((a, b) => {
    const porFecha = b.createdAt.localeCompare(a.createdAt);
    if (porFecha !== 0) return porFecha;
    return (a.currency ?? "").localeCompare(b.currency ?? "");
  });
}
