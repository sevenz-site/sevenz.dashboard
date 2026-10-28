import type { createClient } from "@/lib/supabase/server";
import type { Rango } from "@/lib/reports/rango";

// ═══════════════════════════════════════════════════════════════════════
// LOS DATOS DE LA PESTAÑA «INVENTARIO» — frame `1667:19321`
//
// Tres bloques, en el orden del frame: «Métricas del inventario», «Margen por
// producto» y «Más vendidos».
//
// ───────────────────────────────────────────────────────────────────────
// LO QUE HIZO FALTA ANTES DE QUE ESTA PANTALLA PUDIERA EXISTIR
//
// La migración `163`, del 2026-10-27. Hasta ella `products.stock_opening` era
// el asiento de apertura --lo que el tendero tecleó el día que creó el
// producto-- y nada lo mantenía, así que «Productos disponibles» habría
// descrito el catálogo del día de su alta, no la estantería de hoy.
//
// Decisión del dueño ese día, preguntada con el caso delante: *«Actualicemos
// para que la cantidad de productos se descuenta con cada venta y sacamos la
// data de allí»*. Desde esa migración cada venta la descuenta y cada borrado
// la devuelve, así que la cifra es de hoy.
//
// ───────────────────────────────────────────────────────────────────────
// «PRODUCTOS DISPONIBLES» CUENTA PRODUCTOS, NO UNIDADES. Y no es un matiz.
//
// El frame dibuja `1.245`, que parece una suma de unidades. **Sumarlas sería
// el mismo error que sumar dólares con euros**, que esta app no ha hecho
// nunca: `products.unit` es libre --kilos, docenas, sacos, unidades-- así que
// «1.245» sería tres kilos de harina más dos docenas de huevos más un saco de
// arroz, y ese número no significa nada.
//
// Así que las tres tarjetas cuentan REFERENCIAS, que es además lo que dice la
// tercera por su nombre: «Referencias agotadas».
//
// ───────────────────────────────────────────────────────────────────────
// LOS QUE NO TIENEN CANTIDAD CONTADA NO SE ESCONDEN
//
// Es el borde que hace mentir a esta pantalla si se calla. Medido en dev el
// 2026-10-27: de 21 productos vivos, **solo el 52% tiene cantidad escrita**.
// Un negocio con 11 contados y 10 sin contar vería «Disponibles: 11» y lo
// leería como su catálogo entero.
//
// No son una cuarta tarjeta --el frame dibuja tres-- pero sí una línea debajo
// que dice cuántos quedan fuera de la cuenta. Sin ella, tres cifras correctas
// componen una respuesta falsa.
// ═══════════════════════════════════════════════════════════════════════

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ProductoDeMargen = {
  id: string;
  nombre: string;
  /** El porcentaje que el tendero escribió en la ficha del producto. */
  margenPct: number;
};

export type ProductoVendido = {
  id: string;
  nombre: string;
  /** Unidades vendidas en el rango. Su `unit` propio, nunca sumadas entre sí. */
  unidades: number;
  unidad: string | null;
};

export type Inventario = {
  /** Cuántas unidades quedan para que algo cuente como «por agotarse». */
  umbral: number;
  /** Referencias con cantidad mayor que el umbral. */
  disponibles: number;
  /** Referencias con cantidad entre 1 y el umbral. */
  porAgotarse: number;
  /** Referencias con cantidad exactamente 0. */
  agotadas: number;
  /** Referencias SIN cantidad contada. No entran en ninguna de las tres. */
  sinContar: number;
  totalProductos: number;
  /**
   * Lo que cuesta la mercancía que hay en la estantería, en la moneda con más
   * dinero dentro.
   *
   * UNA SOLA MONEDA Y NO UNA SUMA, por la misma razón de siempre: el costo de
   * un producto se guarda en su propia moneda y esta app no suma monedas. Es
   * el mismo criterio que `dineroPorAtender` ya usa para los pedidos.
   *
   * `null` cuando ningún producto con existencias tiene costo escrito, que
   * hoy es la mitad del catálogo.
   */
  capital: { currency: string; amount: number } | null;
  /** Igual, pero solo de lo que está por agotarse. */
  capitalPorAgotarse: { currency: string; amount: number } | null;
  /**
   * Cuántos productos vivos NO tienen costo escrito.
   *
   * TODOS, no solo los que tienen existencias. Cambió el 2026-10-28 con el
   * frame `1786:15280`, cuyo texto dice la consecuencia: *«Deben tener ese
   * dato para poder monitorear el margen»*. Y el margen aplica a cualquier
   * producto -- tenga existencias o no, se haya vendido o no--, así que
   * contar solo los que tienen stock daría un número más pequeño que la
   * frase que lo acompaña.
   */
  sinCosto: number;
  /**
   * En cuántas monedas distintas hay mercancía.
   *
   * SE DEVUELVE PARA PODER DECIRLO. `capital` enseña solo la moneda con más
   * dinero dentro --sumarlas está prohibido en esta app-- y callar que hay
   * otras convierte una cifra correcta en una impresión falsa: el tendero lee
   * «$35.070» como todo su inventario. Es el mismo problema que los productos
   * sin cantidad contada, resuelto igual: con una línea debajo.
   */
  monedasConMercancia: number;
  margen: ProductoDeMargen[];
  masVendidos: ProductoVendido[];
  /** Cuántas líneas vendidas en el rango no apuntan a un producto del catálogo. */
  lineasSueltas: number;
};

/** Cuántos productos caben en un gráfico de barras de 312px sin que sea una reja. */
const EN_EL_GRAFICO = 6;

export async function cargarInventario({
  supabase,
  ownerId,
  rango,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  rango: Rango;
}): Promise<Inventario> {
  const [resProductos, resDueno, resVentas] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, unit, stock_opening, cost, cost_currency, cost_currency_other, margin_retail_pct",
      )
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .order("name"),
    supabase.from("owners").select("low_stock_threshold").eq("id", ownerId).single(),
    supabase
      .from("sales")
      .select("id")
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", rango.desde.toISOString())
      .lte("created_at", rango.hasta.toISOString()),
  ]);

  // SE MIRA EL ERROR DE LAS TRES. Es la lección que costó un día entero el
  // 2026-10-27: una consulta que fallaba con el error descartado dibujaba
  // ceros perfectamente creíbles en la pestaña de al lado.
  for (const [que, r] of [
    ["productos", resProductos],
    ["dueño", resDueno],
    ["ventas", resVentas],
  ] as const) {
    if (r.error) throw new Error(`inventario: ${que}: ${r.error.message}`);
  }

  const productos = resProductos.data ?? [];
  const umbral = Number(resDueno.data?.low_stock_threshold ?? 5);

  // ── LAS TRES TARJETAS ────────────────────────────────────────────────
  let disponibles = 0;
  let porAgotarse = 0;
  let agotadas = 0;
  let sinContar = 0;
  let sinCosto = 0;
  const capitalPorMoneda: Record<string, number> = {};
  const porAgotarsePorMoneda: Record<string, number> = {};

  for (const p of productos) {
    // SOBRE TODOS LOS VIVOS y fuera del `if` de las existencias: ver la nota
    // del campo. Un producto sin existencias tampoco tiene margen que vigilar
    // si no lleva costo.
    if (p.cost == null) sinCosto++;

    const cantidad = p.stock_opening == null ? null : Number(p.stock_opening);
    if (cantidad == null) {
      sinContar++;
      continue;
    }
    // CON EL UMBRAL EN CERO --«no me avises»-- «por agotarse» queda vacío y
    // todo lo que tenga existencias cuenta como disponible. Es justo lo que
    // esa opción promete, así que no hace falta un caso aparte.
    if (cantidad === 0) agotadas++;
    else if (cantidad <= umbral) porAgotarse++;
    else disponibles++;

    if (cantidad > 0) {
      const costo = p.cost == null ? null : Number(p.cost);
      if (costo != null) {
        // `cost_currency_other` es texto libre para una moneda que no está en
        // la lista. Se respeta tal cual en vez de aplanarla a la de la casa:
        // mezclarla sería inventar una conversión que nadie pidió.
        const moneda = (p.cost_currency as string | null) ?? "USD";
        const clave = moneda === "OTHER" ? (p.cost_currency_other as string) || "OTRA" : moneda;
        capitalPorMoneda[clave] = (capitalPorMoneda[clave] ?? 0) + costo * cantidad;
        if (cantidad <= umbral) {
          porAgotarsePorMoneda[clave] = (porAgotarsePorMoneda[clave] ?? 0) + costo * cantidad;
        }
      }
    }
  }

  const mayor = (m: Record<string, number>) => {
    const filas = Object.entries(m).filter(([, v]) => v > 0);
    if (!filas.length) return null;
    filas.sort((a, b) => b[1] - a[1]);
    return { currency: filas[0][0], amount: filas[0][1] };
  };

  // ── MARGEN POR PRODUCTO ──────────────────────────────────────────────
  //
  // EL PORCENTAJE QUE EL TENDERO ESCRIBIÓ, no uno calculado de las ventas.
  // Es lo que dice el subtítulo del frame --«Dependen del registro del
  // margen»-- y es el único que existe para un producto que aún no se ha
  // vendido ninguna vez.
  const margen: ProductoDeMargen[] = productos
    .filter((p) => p.margin_retail_pct != null)
    .map((p) => ({
      id: p.id as string,
      nombre: p.name as string,
      margenPct: Number(p.margin_retail_pct),
    }))
    .sort((a, b) => b.margenPct - a.margenPct)
    .slice(0, EN_EL_GRAFICO);

  // ── MÁS VENDIDOS ─────────────────────────────────────────────────────
  const idsDeVenta = (resVentas.data ?? []).map((v) => v.id as string);
  let masVendidos: ProductoVendido[] = [];
  let lineasSueltas = 0;

  if (idsDeVenta.length) {
    const { data: lineas, error } = await supabase
      .from("sale_lines")
      .select("product_id, quantity")
      .in("sale_id", idsDeVenta);
    if (error) throw new Error(`inventario: líneas: ${error.message}`);

    const porProducto: Record<string, number> = {};
    for (const l of lineas ?? []) {
      // UNA LÍNEA SIN PRODUCTO NO SE PUEDE ATRIBUIR. Pasa con lo que el
      // tendero teclea a mano en una venta, y se cuenta aparte en vez de
      // desaparecer: si son muchas, «más vendidos» está describiendo una
      // parte pequeña de lo que de verdad se vendió.
      if (!l.product_id) {
        lineasSueltas++;
        continue;
      }
      porProducto[l.product_id as string] =
        (porProducto[l.product_id as string] ?? 0) + Number(l.quantity);
    }

    const nombres = new Map(productos.map((p) => [p.id as string, p]));
    masVendidos = Object.entries(porProducto)
      .map(([id, unidades]) => {
        const p = nombres.get(id);
        return {
          id,
          // Un producto borrado sigue teniendo sus ventas, y esconderlas
          // haría que la suma no cuadrara con lo que el tendero recuerda.
          nombre: (p?.name as string) ?? "Producto borrado",
          unidades,
          unidad: (p?.unit as string | null) ?? null,
        };
      })
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, EN_EL_GRAFICO);
  }

  return {
    umbral,
    disponibles,
    porAgotarse,
    agotadas,
    sinContar,
    totalProductos: productos.length,
    capital: mayor(capitalPorMoneda),
    monedasConMercancia: Object.values(capitalPorMoneda).filter((v) => v > 0).length,
    capitalPorAgotarse: mayor(porAgotarsePorMoneda),
    sinCosto,
    margen,
    masVendidos,
    lineasSueltas,
  };
}
