import type { createClient } from "@/lib/supabase/server";
import type { Rango } from "@/lib/reports/rango";
import type { BolivarRates } from "@/lib/products/price";
import {
  cuentasPorProducto,
  monedaPrincipal,
  type CostoDeProducto,
  type Dinero,
  type LineaVendida,
} from "@/lib/reports/ganancia";

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

// ═══════════════════════════════════════════════════════════════════════
// LAS FÓRMULAS DE «INVENTARIO», UNA POR UNA
//
// Encargo del dueño el 2026-10-29, para poder auditarlas sin leer el archivo
// entero. Dice lo que el código HACE.
//
//   El umbral es `owners.low_stock_threshold` (5 por defecto), y el tendero
//   lo cambia en la propia pantalla.
//
//   Productos disponibles     productos vivos con cantidad > umbral
//   Por agotarse              0 < cantidad <= umbral
//   Referencias agotadas      cantidad === 0
//   (sin cantidad anotada)    cantidad NULL -> NO cuenta en ninguna de las
//                             tres. Es el aviso «N productos no tienen
//                             cantidad». Un NULL no es un cero: ver la
//                             migración 163.
//
//   «$X en mercancía» (Disponibles)
//     Σ costo × cantidad de TODO lo que tiene existencias --disponibles Y por
//     agotarse--, agrupado por `cost_currency`, enseñando la moneda mayor.
//     Solo cuenta lo que tiene costo escrito.
//   «$X en mercancía» (Por agotarse)
//     Lo mismo, restringido a 0 < cantidad <= umbral.
//   Referencias agotadas
//     SIN cifra de dinero, a propósito: con cantidad cero, cualquier valor
//     de ese inventario es cero.
//
//   Ventas proyectadas (hoja de Disponibles)
//     Σ price_retail × cantidad, por la moneda BASE del precio.
//     ⚠️ NO describe el mismo conjunto que «Capital»: el capital solo cuenta
//     productos CON costo y se agrupa por la moneda del COSTO; la proyección
//     cuenta los que tienen precio y se agrupa por la del PRECIO. Medido en
//     dev: de cinco productos con existencias, solo uno cae en los dos lados
//     de la misma tarjeta. Leer «de 34.665 saco 47.740» como el margen de esa
//     mercancía es incorrecto. Pendiente de decidir.
//
//   Margen por producto
//     `products.margin_retail_pct` -- EL PORCENTAJE QUE EL TENDERO ESCRIBIÓ,
//     no uno calculado de las ventas. Es el único que existe para un producto
//     que aún no se ha vendido. Top 6, de mayor a menor.
//
//   Más vendidos
//     Σ `sale_lines.quantity` por producto, de las ventas del rango. Top 6.
//     UNIDADES, no dinero.
//
//   «N productos de este ranking ya no están en tu catálogo»
//     Los ids del tramo dibujado que no están entre los productos vivos --o
//     sea, los que están en la papelera--.
//
//   Total vendido (hojas de Por agotarse y Agotadas)
//     Σ unit_price × quantity de las líneas de ESOS productos, por la moneda
//     de la línea.
//
//   «$X de ganancia» (en las tarjetas de producto de las hojas)
//     Σ (unit_price − costo convertido a la moneda de la línea) × quantity,
//     enseñado en la moneda donde más vendió. La conversión y sus tres casos
//     de `null` están en `lib/reports/ganancia.ts`.
// ═══════════════════════════════════════════════════════════════════════

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ═══════════════════════════════════════════════════════════════════════
// LOS PRODUCTOS QUE UN AVISO NOMBRA
//
// Hasta el 2026-10-28 los avisos solo decían CUÁNTOS eran. El dueño pidió ese
// dia que su «Ver productos» abriera una hoja con las tarjetas: *«debe mostrar
// sheet de respectiva alerta con los cards de los productos mencionados»*.
//
// Un aviso que dice «6 productos no tienen costo» y no dice CUÁLES obliga a
// salir al catálogo y cotejar de memoria -- que es el mismo fallo que
// `order-client-card.tsx` ya documenta: *«mandaba al tendero FUERA del flujo,
// a cotejar de memoria»*.
export type ProductoEnAviso = {
  id: string;
  nombre: string;
  fotoPath: string | null;
  unidad: string | null;
  precio: number | null;
  moneda: string | null;
};

// ═══════════════════════════════════════════════════════════════════════
// UNA FILA DE LAS HOJAS DE LAS TRES TARJETAS
//
// Frames `1673:22429` (Productos disponibles), `1748:14380` (Por agotarse) y
// `1673:22895` (Referencias agotadas). Encargo del dueño el 2026-10-28:
// *«les falta el botón "Ver más", al seleccionar esos botones deben abrir
// sheet con los productos acordes a cada card»*.
//
// Las tres dibujan la misma tarjeta: foto de 48, nombre, la línea de la
// ganancia con su bandera, y un chip que cambia --«Disponible: 000» en verde,
// «Agotado» en rojo-- más la flecha a la ficha.
export type ProductoDeHoja = {
  id: string;
  nombre: string;
  fotoPath: string | null;
  /**
   * Existencias vivas, o `null` si el tendero no las ha anotado.
   *
   * NO SE APLANA A CERO, y es la misma regla que la migración `163` dejó
   * escrita para la columna: un 0 pinta el producto en rojo y «No
   * disponible» en el catálogo del cliente, y «no lo he contado» no es «no
   * me queda». En las tres hojas de Inventario nunca es `null` --sus cubos
   * excluyen lo no contado-- pero la de un proveedor trae TODOS sus
   * productos, los contados y los que no.
   *
   * Salió al probarlo en dev el 2026-10-28: cuatro productos sin cantidad
   * anotada aparecían como «Agotado» en la hoja de «Sin proveedor».
   */
  cantidad: number | null;
  /**
   * Lo que dejó en el periodo, en la moneda en la que más se vendió.
   *
   * `null` cuando no se puede calcular --sin costo escrito, costo en moneda
   * «Otra», o sin tasa para cruzarlas--. Se dibuja «—», nunca 0: ver la
   * cabecera de `ganancia.ts`.
   */
  ganancia: Dinero | null;
};

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
  /** Los que no tienen cantidad anotada, para la hoja de su aviso. */
  sinContarLista: ProductoEnAviso[];
  /** Los que no tienen costo anotado, para la hoja de su aviso. */
  sinCostoLista: ProductoEnAviso[];
  /**
   * Los del ranking de «Más vendidos» que YA NO ESTÁN en el catálogo.
   *
   * Son productos en la papelera: conservan su id, así que sus ventas siguen
   * contando y aparecen en el ranking, pero no están en la lista de productos
   * vivos. Hasta hoy la pantalla los dibujaba como «Producto borrado» sin
   * decir por qué.
   */
  fueraDelCatalogo: ProductoEnAviso[];

  // ── LO QUE ENSEÑAN LAS TRES HOJAS ───────────────────────────────────
  /** Los productos de cada tarjeta, en el orden en que la lista los pinta. */
  disponiblesLista: ProductoDeHoja[];
  porAgotarseLista: ProductoDeHoja[];
  agotadasLista: ProductoDeHoja[];
  /**
   * Capital en inventario, TODAS las monedas.
   *
   * La tarjeta de la pestaña enseña solo la mayor --sumar monedas está
   * prohibido en esta app-- pero en una hoja hay sitio para las dos tarjetas
   * que el frame dibuja, una por moneda. Es la misma cifra, desglosada.
   */
  capitalPorMoneda: Dinero[];
  /** Lo que daría vender al detal lo que hay en la estantería, por moneda. */
  ventasProyectadas: Dinero[];
  /** «Total vendido» en el periodo de los de cada tarjeta, por moneda. */
  vendidoPorAgotarse: Dinero[];
  vendidoAgotadas: Dinero[];
};

/** Cuántos productos caben en un gráfico de barras de 312px sin que sea una reja. */
const EN_EL_GRAFICO = 6;

export async function cargarInventario({
  supabase,
  ownerId,
  rango,
  rates,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  rango: Rango;
  /**
   * Las tasas del día, para poder restar un costo en dólares de una venta en
   * euros. `null` en un negocio colombiano o con el BCV sin responder: la
   * ganancia de las líneas cruzadas queda en `null` y se dibuja «—».
   */
  rates: BolivarRates | null;
}): Promise<Inventario> {
  const [resProductos, resDueno, resVentas] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, unit, stock_opening, cost, cost_currency, cost_currency_other, margin_retail_pct, photo_path, price_retail, base_currency_retail, base_currency",
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
  const sinContarLista: ProductoEnAviso[] = [];
  const sinCostoLista: ProductoEnAviso[] = [];
  const comoAviso = (p: Record<string, unknown>): ProductoEnAviso => ({
    id: p.id as string,
    nombre: p.name as string,
    fotoPath: (p.photo_path as string | null) ?? null,
    unidad: (p.unit as string | null) ?? null,
    precio: p.price_retail == null ? null : Number(p.price_retail),
    moneda: (p.base_currency_retail as string | null) ?? (p.base_currency as string | null) ?? null,
  });
  const capitalPorMoneda: Record<string, number> = {};
  const porAgotarsePorMoneda: Record<string, number> = {};
  // ── LOS TRES CUBOS, CON SUS FILAS ────────────────────────────────────
  //
  // Se guardan las filas crudas y no `ProductoDeHoja` ya montado porque la
  // ganancia necesita las ventas, que todavía no se han leído aquí abajo.
  type Bruto = Record<string, unknown>;
  const brutos: Record<"disp" | "pocos" | "cero", Bruto[]> = { disp: [], pocos: [], cero: [] };
  // Lo que daría vender al detal lo que hay en la estantería, por la moneda
  // BASE de cada precio -- que no tiene por qué ser la del costo, y por eso
  // se cuenta en su propio montón en vez de mezclarse con el capital.
  const proyectadasPorMoneda: Record<string, number> = {};

  for (const p of productos) {
    // SOBRE TODOS LOS VIVOS y fuera del `if` de las existencias: ver la nota
    // del campo. Un producto sin existencias tampoco tiene margen que vigilar
    // si no lleva costo.
    if (p.cost == null) {
      sinCosto++;
      sinCostoLista.push(comoAviso(p));
    }

    const cantidad = p.stock_opening == null ? null : Number(p.stock_opening);
    if (cantidad == null) {
      sinContar++;
      sinContarLista.push(comoAviso(p));
      continue;
    }
    // CON EL UMBRAL EN CERO --«no me avises»-- «por agotarse» queda vacío y
    // todo lo que tenga existencias cuenta como disponible. Es justo lo que
    // esa opción promete, así que no hace falta un caso aparte.
    if (cantidad === 0) {
      agotadas++;
      brutos.cero.push(p);
    } else if (cantidad <= umbral) {
      porAgotarse++;
      brutos.pocos.push(p);
    } else {
      disponibles++;
      brutos.disp.push(p);
    }

    if (cantidad > 0 && p.price_retail != null) {
      const base =
        (p.base_currency_retail as string | null) ?? (p.base_currency as string | null) ?? "USD";
      proyectadasPorMoneda[base] =
        (proyectadasPorMoneda[base] ?? 0) + Number(p.price_retail) * cantidad;
    }

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
  const fueraDelCatalogo: ProductoEnAviso[] = [];

  // LAS LÍNEAS SE LEEN UNA SOLA VEZ Y CON MONEDA Y PRECIO. Hasta hoy traían
  // solo `product_id, quantity`, que es lo que «Más vendidos» necesita; las
  // hojas necesitan además lo que se cobró por cada una para sacar la
  // ganancia. Una segunda consulta por lo mismo sería un segundo sitio desde
  // el que esas dos cifras pueden separarse.
  const vendidas: LineaVendida[] = [];

  if (idsDeVenta.length) {
    const { data: lineas, error } = await supabase
      .from("sale_lines")
      .select("product_id, quantity, currency, unit_price")
      .in("sale_id", idsDeVenta);
    if (error) throw new Error(`inventario: líneas: ${error.message}`);

    const porProducto: Record<string, number> = {};
    for (const l of lineas ?? []) {
      if (l.product_id) {
        vendidas.push({
          productId: l.product_id as string,
          currency: l.currency as string,
          unitPrice: Number(l.unit_price),
          quantity: Number(l.quantity),
        });
      }
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

    // ── LOS DEL RANKING QUE YA NO ESTÁN EN EL CATÁLOGO ─────────────────
    //
    // Un producto en la papelera CONSERVA SU ID, así que sus ventas siguen
    // contando y puede salir en el ranking -- pero no está en `productos`,
    // que filtra `trashed_at`. Hasta hoy la pantalla lo dibujaba como
    // «Producto borrado» sin decir por qué ni cuál era.
    //
    // SE PIDEN SUS NOMBRES EN UNA SEGUNDA CONSULTA, y solo los del tramo que
    // se dibuja: traer la papelera entera para nombrar uno o dos sería pagar
    // una lista larga en cada carga de esta pantalla.
    const idsDelRanking = Object.entries(porProducto)
      .sort((a, b) => b[1] - a[1])
      .slice(0, EN_EL_GRAFICO)
      .map(([id]) => id);
    const huerfanos = idsDelRanking.filter((id) => !nombres.has(id));
    if (huerfanos.length) {
      const { data: fuera, error: eFuera } = await supabase
        .from("products")
        .select("id, name, unit, photo_path, price_retail, base_currency_retail, base_currency")
        .eq("owner_id", ownerId)
        .in("id", huerfanos);
      if (eFuera) throw new Error(`inventario: fuera del catálogo: ${eFuera.message}`);
      for (const p of fuera ?? []) fueraDelCatalogo.push(comoAviso(p));
    }

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

  // ── LAS TRES HOJAS ───────────────────────────────────────────────────
  //
  // La ganancia sale de `ganancia.ts`, el mismo sitio del que la saca la
  // pestaña «Proveedores». Ver allí por qué el costo se convierte y por qué
  // un `null` no es un cero.
  const costos: Map<string, CostoDeProducto> = new Map(
    productos.map((p) => [
      p.id as string,
      {
        costo: p.cost == null ? null : Number(p.cost),
        monedaCosto: (p.cost_currency as string | null) ?? null,
      },
    ]),
  );
  const cuentas = cuentasPorProducto(vendidas, costos, rates);

  const comoFila = (p: Record<string, unknown>): ProductoDeHoja => {
    const c = cuentas.get(p.id as string);
    const moneda = c ? monedaPrincipal(c.ingresos) : null;
    // `?? null` Y NO `?? 0`: si esa moneda no tiene ganancia calculada --su
    // costo falta o está en «Otra»-- la fila dice «—». Un 0 ahí se leería
    // como «no te dejó nada», que es otra afirmación y es falsa.
    const monto = c && moneda != null ? (c.ganancia[moneda] ?? null) : null;
    return {
      id: p.id as string,
      nombre: p.name as string,
      fotoPath: (p.photo_path as string | null) ?? null,
      cantidad: Number(p.stock_opening ?? 0),
      ganancia: moneda != null && monto != null ? { currency: moneda, amount: monto } : null,
    };
  };

  // LO VENDIDO DE UN GRUPO, por moneda de venta. Es la cifra de las tarjetas
  // «Total vendido» de las hojas de «Por agotarse» y «Referencias agotadas».
  const vendidoDe = (filas: Record<string, unknown>[]): Dinero[] => {
    const acc: Record<string, number> = {};
    for (const p of filas) {
      const c = cuentas.get(p.id as string);
      if (!c) continue;
      for (const [m, v] of Object.entries(c.ingresos)) acc[m] = (acc[m] ?? 0) + v;
    }
    return enFilas(acc);
  };

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
    sinContarLista,
    sinCostoLista,
    fueraDelCatalogo,
    disponiblesLista: brutos.disp.map(comoFila),
    porAgotarseLista: brutos.pocos.map(comoFila),
    agotadasLista: brutos.cero.map(comoFila),
    capitalPorMoneda: enFilas(capitalPorMoneda),
    ventasProyectadas: enFilas(proyectadasPorMoneda),
    vendidoPorAgotarse: vendidoDe(brutos.pocos),
    vendidoAgotadas: vendidoDe(brutos.cero),
  };
}

/**
 * Un montón `{moneda: importe}` pasado a filas ordenadas de mayor a menor.
 *
 * ORDENADAS Y NO EN EL ORDEN DEL OBJETO: las claves de un objeto salen en el
 * orden en que se insertaron, o sea en el orden alfabético de los productos,
 * que no significa nada. Así la tarjeta de la izquierda es siempre la del
 * libro con más dinero, en las tres hojas y entre cargas.
 */
function enFilas(m: Record<string, number>): Dinero[] {
  return Object.entries(m)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([currency, amount]) => ({ currency, amount }));
}
