import { cargarDevoluciones, lineasDevueltas } from "@/lib/reports/devoluciones";
import type { createClient } from "@/lib/supabase/server";
import { readAllByIds, readAllPages } from "@/lib/supabase/read-all";
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

// ───────────────────────────────────────────────────────────────────────
// LAS FÓRMULAS DE «PROVEEDORES», para auditarlas de un vistazo
//
//   Productos: N
//     Productos vivos agrupados por `products.supplier`, ignorando caja y
//     tildes. «Makro» y «Makro C.A.» siguen siendo dos: el campo es texto
//     libre y no hay forma de saberlo desde aquí.
//
//   Margen: X %
//     (Σ ganancia ÷ Σ costo) × 100 -- SOBRE EL COSTO, igual que
//     `marginFromPrice` y `suggestedPrice`. Solo entran las líneas cuya
//     ganancia se pudo calcular, numerador y denominador a la vez. Con varias
//     monedas en juego los dos lados se llevan a bolívares, porque un
//     PORCENTAJE sí puede cruzar monedas aunque una suma de dinero no.
//     «—» cuando ese proveedor no vendió nada valorable en el periodo. Nunca
//     0 %, que diría que vende sin ganar nada.
//
//   Sin proveedor
//     Fila propia, siempre la última. No es un proveedor: es el hueco.
//
//   Orden
//     Por número de productos, de mayor a menor. El frame no dice el criterio
//     --dibuja un «Ordenar por» que la app todavía no tiene-- y este es el
//     único que no depende de que haya habido ventas.
// ───────────────────────────────────────────────────────────────────────

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
  proveedorClave = null,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  rango: Rango;
  rates: BolivarRates | null;
  /**
   * Acota el apartado a un proveedor, por su clave normalizada.
   *
   * SE FILTRA AL FINAL Y NO EN LA CONSULTA, al contrario que el de productos:
   * la clave es el nombre normalizado --sin caja ni tildes-- y esa
   * normalización vive en JavaScript, no en Postgres. Filtrar en la consulta
   * exigiría repetirla en SQL, que es el segundo sitio desde el que «Makro» y
   * «MAKRO» volverían a ser dos proveedores.
   */
  proveedorClave?: string | null;
}): Promise<ProveedorEnReporte[]> {
  // SE MIRA EL ERROR DE LAS DOS, por la misma lección del 2026-10-27 que
  // `inventario.ts` recoge: un error descartado dibuja ceros creíbles.
  // The paged reads throw on any page's error; same message as before.
  const conNombre = <T,>(que: string, p: Promise<T>) =>
    p.catch((e: Error) => {
      throw new Error(`proveedores: ${que}: ${e.message}`);
    });

  const [productos, ventas] = await Promise.all([
    // PL-34: every row, not the first 1,000 (lib/supabase/read-all.ts).
    conNombre(
      "productos",
      readAllPages<Record<string, unknown>>((from, to) =>
        supabase
          .from("products")
          .select("id, name, supplier, cost, cost_currency, photo_path, stock_opening", { count: "exact" })
          .eq("owner_id", ownerId)
          .is("trashed_at", null)
          .order("name")
          .order("id")
          .range(from, to),
      ),
    ),
    // PL-34: every row, not the first 1,000 (lib/supabase/read-all.ts).
    conNombre(
      "ventas",
      readAllPages<Record<string, unknown>>((from, to) =>
        supabase
          .from("sales")
          .select("id", { count: "exact" })
          .eq("owner_id", ownerId)
          .is("deleted_at", null)
          .gte("created_at", rango.desde.toISOString())
          .lte("created_at", rango.hasta.toISOString())
          .order("id")
          .range(from, to),
      ),
    ),
  ]);

  if (!productos.length) return [];

  const idsDeVenta = ventas.map((v) => v.id as string);
  // What came back counts as a sold line with a negative quantity: see
  // `lib/reports/devoluciones.ts`.
  const vendidas: (LineaVendida & { supplier: string | null })[] = lineasDevueltas(
    await cargarDevoluciones(supabase, {
      ownerId,
      desdeIso: rango.desde.toISOString(),
      hastaIso: rango.hasta.toISOString(),
    }),
  );
  if (idsDeVenta.length) {
    // PL-34: every row, not the first 1,000 (lib/supabase/read-all.ts).
    const lineas = await conNombre(
      "líneas",
      readAllByIds<Record<string, unknown>>(idsDeVenta, (batch, from, to) =>
        supabase
          .from("sale_lines")
          .select("product_id, quantity, currency, unit_price, unit_cost, supplier", { count: "exact" })
          .in("sale_id", batch)
          .order("id")
          .range(from, to),
      ),
    );
    for (const l of lineas ?? []) {
      if (!l.product_id) continue;
      vendidas.push({
        productId: l.product_id as string,
        currency: l.currency as string,
        unitPrice: Number(l.unit_price),
        quantity: Number(l.quantity),
        unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
        supplier: (l.supplier as string | null) ?? null,
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

  // EACH LINE COUNTS FOR THE SUPPLIER OF ITS DAY (migration 195, owner's request of
  // 2026-11-06). Grouping by the product's current supplier moved every past sale along with
  // it, and the old supplier's margin went too. A line with no frozen supplier uses the
  // current one, which is how every line behaved until then.
  const proveedorActual = new Map(productos.map((p) => [p.id as string, ((p.supplier as string | null) ?? "").trim()]));
  const claveDe = (escrito: string) => (escrito === "" ? "" : normalizar(escrito));
  const lineasDe = new Map<string, { nombre: string; lineas: LineaVendida[] }>();
  for (const l of vendidas) {
    const escrito = (l.supplier ?? proveedorActual.get(l.productId) ?? "").trim();
    const clave = claveDe(escrito);
    const entrada = lineasDe.get(clave) ?? { nombre: escrito, lineas: [] };
    entrada.lineas.push(l);
    lineasDe.set(clave, entrada);
  }
  const cuentasDe = new Map(
    [...lineasDe.entries()].map(([clave, e]) => [clave, cuentasPorProducto(e.lineas, costos, rates)]),
  );

  // ── AGRUPAR ──────────────────────────────────────────────────────────
  const grupos = new Map<
    string,
    { nombre: string; filas: ProductoDeHoja[]; cuentas: CuentaDeProducto[] }
  >();

  const agregar = (clave: string, escrito: string, p: (typeof productos)[number]) => {
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
    const c = cuentasDe.get(clave)?.get(p.id as string);
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
  };

  for (const p of productos) {
    const escrito = proveedorActual.get(p.id as string) ?? "";
    agregar(claveDe(escrito), escrito, p);
  }

  // A product that left a supplier stays listed under it for what it sold there, so the
  // margin of that row can be traced to something. It is the only way a supplier with no
  // product left today can appear, and it does so only in a range where it sold.
  const porId = new Map(productos.map((p) => [p.id as string, p]));
  for (const [clave, cuentasDelProveedor] of cuentasDe) {
    for (const productId of cuentasDelProveedor.keys()) {
      const p = porId.get(productId);
      if (!p || claveDe(proveedorActual.get(productId) ?? "") === clave) continue;
      agregar(clave, lineasDe.get(clave)?.nombre ?? "", p);
    }
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
  const visibles = proveedorClave ? filas.filter((f) => f.clave === proveedorClave) : filas;

  visibles.sort((a, b) => {
    if (a.sinProveedor !== b.sinProveedor) return a.sinProveedor ? 1 : -1;
    if (b.productos !== a.productos) return b.productos - a.productos;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  return visibles;
}
