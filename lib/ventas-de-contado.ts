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
//   · CADA LIBRO DECIDE SOLO SI ES CONTADO O FIADO. Esto cambió el
//     2026-10-20 y es lo contrario de lo que decía aquí antes.
//
//     La regla vieja era «solo las ventas pagadas ENTERAS llevan fila de
//     contado», y descartaba la venta completa en cuanto dejara un cargo en
//     cualquier moneda. Parecía bien y escondía una compra entera: el dueño
//     compró lapiceros en dólares pagados al momento y un casco en euros a
//     crédito, y el historial enseñaba el fiado de euros y NADA de los diez
//     dólares cobrados. No había fila que los dijera.
//
//     Ahora el par (venta, libro) decide por su cuenta: los dólares están
//     cubiertos, así que salen como «De contado»; los euros no, así que salen
//     como «Fiado». Dos filas independientes, sin anidar, y lo único que
//     comparten es la fecha. Palabras del dueño: *«ese fiado registra otra
//     tarjeta en el historial por separada, y el detalle al abrirlas son
//     independiente, no se vinculan entre una y otra, eso hará más fácil el
//     filtrado del historial y la sección de reportes»*.
//
//     Lo que la regla vieja quería evitar sigue evitado, y por eso el descarte
//     no desaparece sino que se afina: un libro que dejó cargo NO saca además
//     una fila de contado, o la misma compra se contaría dos veces.
export type VentaDeContado = {
  saleId: string;
  createdAt: string;
  // El libro al que entra, con la misma regla que `movements.currency`: `null`
  // es el libro de un negocio colombiano, que es una respuesta y no una
  // ausencia.
  currency: LedgerCurrency | null;
  // Lo cobrado en ESE libro, que en una venta pagada entera es su total.
  amount: number;
  // La tasa sellada de ese cobro, para los bolívares «al día de compra».
  // `null` en un negocio colombiano y en lo anterior al sellado; entonces la
  // fila no dibuja esa línea en vez de inventarse una conversión.
  tasaSellada: number | null;
  // LOS BOLÍVARES QUE SE TECLEARON, cuando se tecleó en bolívares. Mandan
  // sobre la conversión: ver `entry_currency` en `PagoCrudo`.
  tecleadoEnBs: number | null;
  // El código de la transacción, para el buscador del historial y para la
  // ficha. Una venta pagada entera no escribe movimiento, así que su código
  // vive en `sales` y este es el único sitio por el que llega a la pantalla.
  transactionCode: string | null;
  lineas: SaleLineRow[];
};

// Las filas crudas, tal como salen de la base. Se pasan así —y no cada tabla
// por su lado— para que esta función sea pura y se pueda probar sin una
// sesión ni una base delante.
export type VentaCruda = {
  id: string;
  created_at: string;
  // El código de la transacción — migración 147. Opcional porque las pruebas
  // de esta función construyen ventas a mano y no tienen por qué inventarse
  // uno; en la app siempre viene.
  transaction_code?: string | null;
};
export type PagoCrudo = {
  sale_id: string;
  currency: string;
  amount: number | string;
  // LA TASA QUE EL PAGO SELLÓ. El frame `1512:10061` pide que la fila de una
  // venta de contado diga «Bs. … Al día de compra», no los bolívares de hoy:
  // ese dinero ya cambió de manos, así que convertirlo a la tasa de hoy
  // describe una operación que nadie hizo. Es la misma regla que ya rige la
  // tarjeta de un abono.
  rate_used?: number | string | null;
  // EN QUÉ SE TECLEÓ ESE PAGO Y CUÁNTO. Con `'VES'` aquí, la fila enseña ESOS
  // bolívares en vez de `amount × rate_used`, que es una reconversión y no da
  // lo mismo. Ver la regla «siempre manda el monto que tecleó el tendero» en
  // CLAUDE.md y lo que costó el 2026-10-24.
  entry_currency?: string | null;
  entry_amount?: number | string | null;
};
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

// LA CLAVE DE UNA FILA: una venta Y un libro. No una venta.
//
// Se exporta porque quien llama tiene que construir el conjunto de claves con
// cargo exactamente igual, y dos sitios formateando la misma cadena a mano es
// cómo se separan sin que nada avise.
export function claveDeFila(saleId: string, moneda: LedgerCurrency | null): string {
  return `${saleId}|${moneda ?? ""}`;
}

/**
 * Convierte las ventas de un cliente en filas de historial.
 *
 * `clavesConCargo` son los pares (venta, libro) que SÍ dejaron un cargo en
 * `movements`. Esos se descartan: ya tienen su fila, y es la del fiado.
 */
export function filasDeContado(
  ventas: VentaCruda[],
  pagos: PagoCrudo[],
  lineas: LineaCruda[],
  clavesConCargo: Set<string>,
): VentaDeContado[] {
  const porVenta = new Map<string, VentaCruda>();
  for (const v of ventas) porVenta.set(v.id, v);
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
  const tasas = new Map<string, number>();
  const bsTecleados = new Map<string, number>();
  const mezclados = new Set<string>();
  for (const p of pagos) {
    if (!porVenta.has(p.sale_id)) continue;
    const clave = `${p.sale_id}|${libro(p.currency) ?? ""}`;
    sumas.set(clave, (sumas.get(clave) ?? 0) + Number(p.amount));
    // LA TASA DEL PRIMER PAGO DE ESE LIBRO, y no una media de todos. Los
    // pagos de una misma venta se sellan en el mismo instante, así que son la
    // misma tasa; si alguna vez no lo fueran, promediarlas daría un número
    // que no selló ningún pago. Se queda la primera, que es un dato real.
    if (!tasas.has(clave) && p.rate_used != null) tasas.set(clave, Number(p.rate_used));
    // LOS BOLÍVARES TECLEADOS DE ESE LIBRO, sumados igual que los importes:
    // dos pagos en bolívares de la misma venta son una fila por su suma.
    //
    // SOLO SI TODOS LOS PAGOS DE ESE LIBRO SE TECLEARON EN BOLÍVARES. Con uno
    // en bolívares y otro en dólares no hay una cifra tecleada que describa
    // la fila entera, y entonces manda la conversión, que al menos es
    // coherente. Es la misma regla que la RPC del cliente ya aplica.
    if (p.entry_currency === "VES" && p.entry_amount != null) {
      bsTecleados.set(clave, (bsTecleados.get(clave) ?? 0) + Number(p.entry_amount));
    } else {
      mezclados.add(clave);
    }
  }

  const filas: VentaDeContado[] = [];
  for (const [clave, amount] of sumas) {
    // EL DESCARTE ES POR MONEDA, NO POR VENTA, y ese es el cambio entero del
    // 2026-10-20. Antes, una venta que dejara un cargo en CUALQUIER moneda
    // perdía su fila de contado en TODAS -- así que la compra mixta del dueño
    // (lapiceros en dólares pagados, casco en euros fiado) enseñaba solo el
    // fiado y los diez dólares cobrados no aparecían en ninguna parte.
    //
    // Sus palabras, el 2026-10-20: *«esto registra un movimiento en dólares de
    // "De contado" en el historial y lleva a fiado su cuenta en Euros, ese
    // fiado registra otra tarjeta en el historial por separada»*.
    if (clavesConCargo.has(clave)) continue;
    const [saleId, moneda] = clave.split("|");
    const venta = porVenta.get(saleId);
    if (!venta) continue;
    filas.push({
      saleId,
      createdAt: venta.created_at,
      currency: (moneda || null) as LedgerCurrency | null,
      // Dos decimales, el mismo redondeo que el resto del código de dinero.
      amount: Math.round(amount * 100) / 100,
      tasaSellada: tasas.get(clave) ?? null,
      tecleadoEnBs: mezclados.has(clave)
        ? null
        : (bsTecleados.get(clave) != null
            ? Math.round(bsTecleados.get(clave)! * 100) / 100
            : null),
      transactionCode: venta.transaction_code ?? null,
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
