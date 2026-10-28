import type { createClient } from "@/lib/supabase/server";
import type { Rango } from "@/lib/reports/rango";
import type { BolivarRates } from "@/lib/products/price";
import {
  cuentasPorProducto,
  margenReal,
  monedaPrincipal,
  sumarCuentas,
  type CostoDeProducto,
  type CuentaDeProducto,
  type LineaVendida,
} from "@/lib/reports/ganancia";
import type { ProductoDeHoja } from "@/lib/reports/inventario";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ═══════════════════════════════════════════════════════════════════════
// LA PESTAÑA «PROVEEDORES» — frame `1749:14583`
//
// Un bloque, «Métricas de proveedores», y una lista de filas: avatar con las
// iniciales, nombre, «Productos: 000  Margen: 00% ↗» y una flecha.
//
// ───────────────────────────────────────────────────────────────────────
// UN PROVEEDOR AQUÍ NO ES UNA ENTIDAD: ES UN TEXTO ESCRITO A MANO
//
// `products.supplier` es `text` libre, y eso fue una decisión deliberada del
// dueño el 2026-10-14, escrita en la migración `103`: *«texto libre y no
// entidad (…) adelantarla aqui obligaria a disenarla sin haberla
// investigado»*.
//
// CONSECUENCIA QUE HAY QUE SABER PARA LEER ESTA PANTALLA: dos filas pueden
// ser el mismo sitio escrito distinto. Se agrupa ignorando caja y tildes --la
// misma `normalizar` que ya usa el autocompletado del formulario, por la
// misma razón: *«quien escribe "Exito" sin tilde no ve "Éxito", lo da por
// nuevo, y acaba con dos proveedores que son el mismo»*-- pero «Makro» y
// «Makro C.A.» siguen siendo dos. No hay forma de arreglarlo desde aquí, y
// fingir lo contrario sería inventar una fusión que nadie pidió.
//
// ───────────────────────────────────────────────────────────────────────
// EL MARGEN ES EL REAL DE LAS VENTAS, NO EL PORCENTAJE ESCRITO
//
// Decisión del dueño el 2026-10-28, elegida entre tres opciones con su coste
// delante. Lo que cuesta, y él lo eligió sabiéndolo: **un proveedor cuyos
// productos no se vendieron en el periodo sale sin margen** --«—»-- y no con
// el porcentaje que el tendero escribió en cada ficha.
//
// Y DESPLAZA, SIN BORRARLO, lo que el bloque «Margen por producto» de la
// pestaña de al lado decide para sí mismo: *«EL PORCENTAJE QUE EL TENDERO
// ESCRIBIÓ, no uno calculado de las ventas (…) es el único que existe para un
// producto que aún no se ha vendido ninguna vez»*. Las dos cosas son ciertas
// y responden a preguntas distintas: aquella dice qué margen PRETENDE sacarle
// a cada producto, esta dice cuál le sacó de verdad a ese proveedor.
//
// Si algún día las dos cifras se contradicen en pantalla, no es un fallo: es
// la diferencia entre el precio de lista y lo que se cobró.
// ═══════════════════════════════════════════════════════════════════════

export type ProveedorEnReporte = {
  /** La clave normalizada con la que se agrupó. Única, sirve de `key`. */
  clave: string;
  /** Como el tendero lo escribió la primera vez, o «Sin proveedor». */
  nombre: string;
  /** Las dos letras del avatar. */
  iniciales: string;
  /** `true` solo en la fila de los que no tienen el dato. */
  sinProveedor: boolean;
  productos: number;
  /** El margen real del periodo. `null` si no vendió nada valorable. */
  margenPct: number | null;
  /** Sus productos, para la hoja que abre la fila. */
  lista: ProductoDeHoja[];
};

/** Lo mismo que `lib/products/supplier.ts`, y por el mismo motivo. */
function normalizar(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Las dos letras del avatar.
 *
 * DE DOS PALABRAS, UNA DE CADA UNA --«La china Mari» -> «LC»--; de una sola,
 * sus dos primeras letras --«Éxito» -> «ÉX»--. Es lo que el frame dibuja
 * («MD») y lo que hace que dos proveedores distintos no compartan avatar tan
 * a menudo como con una sola letra.
 */
function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  const uno = palabras[0] ?? "";
  return (uno.slice(0, 2) || "?").toUpperCase();
}

/** El rótulo de la fila de los que no tienen el dato. */
export const SIN_PROVEEDOR = "Sin proveedor";

export async function cargarProveedores({
  supabase,
  ownerId,
  rango,
  rates,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  rango: Rango;
  rates: BolivarRates | null;
}): Promise<ProveedorEnReporte[]> {
  const [resProductos, resVentas] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, supplier, cost, cost_currency, photo_path, stock_opening")
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .order("name"),
    supabase
      .from("sales")
      .select("id")
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .gte("created_at", rango.desde.toISOString())
      .lte("created_at", rango.hasta.toISOString()),
  ]);

  // SE MIRA EL ERROR DE LAS DOS, por la misma lección del 2026-10-27 que
  // `inventario.ts` recoge: un error descartado dibuja ceros creíbles.
  for (const [que, r] of [
    ["productos", resProductos],
    ["ventas", resVentas],
  ] as const) {
    if (r.error) throw new Error(`proveedores: ${que}: ${r.error.message}`);
  }

  const productos = resProductos.data ?? [];
  if (!productos.length) return [];

  const idsDeVenta = (resVentas.data ?? []).map((v) => v.id as string);
  const vendidas: LineaVendida[] = [];
  if (idsDeVenta.length) {
    const { data: lineas, error } = await supabase
      .from("sale_lines")
      .select("product_id, quantity, currency, unit_price")
      .in("sale_id", idsDeVenta);
    if (error) throw new Error(`proveedores: líneas: ${error.message}`);
    for (const l of lineas ?? []) {
      if (!l.product_id) continue;
      vendidas.push({
        productId: l.product_id as string,
        currency: l.currency as string,
        unitPrice: Number(l.unit_price),
        quantity: Number(l.quantity),
      });
    }
  }

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

  // ── AGRUPAR ──────────────────────────────────────────────────────────
  const grupos = new Map<
    string,
    { nombre: string; filas: ProductoDeHoja[]; cuentas: CuentaDeProducto[] }
  >();

  for (const p of productos) {
    const escrito = ((p.supplier as string | null) ?? "").trim();
    const clave = escrito === "" ? "" : normalizar(escrito);
    let g = grupos.get(clave);
    if (!g) {
      // EL NOMBRE ES EL DEL PRIMERO QUE LLEGA, y los productos vienen
      // ordenados por nombre, así que es estable entre cargas. Es la misma
      // regla que `proveedoresUnicos`: se deduplica ignorando la caja pero se
      // devuelve lo que el tendero escribió, no una forma normalizada que él
      // nunca tecleó.
      g = { nombre: escrito === "" ? SIN_PROVEEDOR : escrito, filas: [], cuentas: [] };
      grupos.set(clave, g);
    }
    const c = cuentas.get(p.id as string);
    if (c) g.cuentas.push(c);
    const moneda = c ? monedaPrincipal(c.ingresos) : null;
    const monto = c && moneda != null ? (c.ganancia[moneda] ?? null) : null;
    g.filas.push({
      id: p.id as string,
      nombre: p.name as string,
      fotoPath: (p.photo_path as string | null) ?? null,
      cantidad: p.stock_opening == null ? null : Number(p.stock_opening),
      ganancia: moneda != null && monto != null ? { currency: moneda, amount: monto } : null,
    });
  }

  const filas: ProveedorEnReporte[] = [...grupos.entries()].map(([clave, g]) => ({
    clave: clave === "" ? "__sin__" : clave,
    nombre: g.nombre,
    iniciales: clave === "" ? "—" : iniciales(g.nombre),
    sinProveedor: clave === "",
    productos: g.filas.length,
    margenPct: margenReal(sumarCuentas(g.cuentas), rates),
    lista: g.filas,
  }));

  // ── EL ORDEN ─────────────────────────────────────────────────────────
  //
  // «SIN PROVEEDOR» SIEMPRE AL FINAL, por decisión del dueño el 2026-10-28:
  // la pidió como fila propia en vez de esconder esos productos, para que se
  // vea que existen y que les falta el dato. Al final porque no es un
  // proveedor: es el hueco.
  //
  // Y EL RESTO POR NÚMERO DE PRODUCTOS, de mayor a menor. El frame no dice el
  // criterio --su cabecera dibuja un «Ordenar por» que esta app todavía no
  // tiene-- y este es el único que no depende de que haya habido ventas: por
  // margen, un catálogo sin vender saldría en orden alfabético disfrazado de
  // ranking.
  filas.sort((a, b) => {
    if (a.sinProveedor !== b.sinProveedor) return a.sinProveedor ? 1 : -1;
    if (b.productos !== a.productos) return b.productos - a.productos;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  return filas;
}
