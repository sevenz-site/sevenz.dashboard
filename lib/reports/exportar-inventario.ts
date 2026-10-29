import type { createClient } from "@/lib/supabase/server";
import type { BolivarRates } from "@/lib/products/price";
import type { Rango } from "@/lib/reports/rango";
import { aISO } from "@/lib/reports/rango";
import { cargarInventario, type ProductoDeHoja } from "@/lib/reports/inventario";
import { cargarProveedores } from "@/lib/reports/proveedores";
import { documento, fila, importe } from "@/lib/reports/csv";
import type { Exportacion, MotivoDeFallo } from "@/lib/reports/exportar-movimientos";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ═══════════════════════════════════════════════════════════════════════
// LAS DESCARGAS DE «INVENTARIO» Y «PROVEEDORES»
//
// Encargo del dueño el 2026-10-29: *«el menú que se muestra al seleccionar
// "Descargar" (…) debe mostrar las opciones de cada tab»*. Hasta hoy solo
// existía la de Facturación, porque los otros dos apartados eran estado
// vacío -- y esa razón caducó cuando se construyeron.
//
// ───────────────────────────────────────────────────────────────────────
// LLAMAN AL MISMO CARGADOR QUE LA PANTALLA, Y ESA ES LA DECISIÓN ENTERA
//
// `cargarInventario` y `cargarProveedores` son las funciones que dibujan los
// dos apartados. El fichero sale de ellas y no de una consulta propia, así
// que **no puede decir una cifra distinta de la que el tendero acaba de ver
// en pantalla**.
//
// La alternativa --consultas propias, más rápidas y a medida-- es exactamente
// cómo nacen dos verdades: alguien cambia la definición de «disponibles» en
// la pantalla, nadie se acuerda del fichero, y a partir de ese día el CSV
// describe una app que ya no existe. Este repo tiene esa lección escrita dos
// veces, en `ventas-del-periodo.ts` y en `qa:puntaje`.
//
// LO QUE CUESTA, dicho: se descargan las MISMAS cifras que se ven, ni una
// más. Un CSV con el costo y el precio producto a producto sería más útil
// para quien quiera rehacer las cuentas en Excel, y hoy no sale -- porque la
// pantalla tampoco los enseña. El día que haga falta, se añaden a los dos
// sitios a la vez.
//
// ───────────────────────────────────────────────────────────────────────
// NO HAY PAGINACIÓN, Y AQUÍ SÍ ESTÁ BIEN
//
// `exportar-movimientos.ts` pagina porque PostgREST corta en 1.000 filas en
// silencio y un libro de movimientos las pasa. Un catálogo no: estas dos
// listas salen de `products`, que la pantalla ya carga entera sin paginar
// --lo dejó escrito la migración `103`-- y un negocio con mil referencias
// rompería la pantalla antes que el fichero. Si alguna vez pasa, se arregla
// en el cargador y los dos heredan el arreglo.
// ═══════════════════════════════════════════════════════════════════════

/** El estado de un producto, con las mismas reglas que las tres tarjetas. */
function estado(p: ProductoDeHoja, umbral: number): string {
  if (p.cantidad == null) return "Sin cantidad anotada";
  if (p.cantidad <= 0) return "Agotado";
  return p.cantidad <= umbral ? "Disponible, por agotarse" : "Disponible";
}

function cabecera(nombreDelNegocio: string, apartado: string, rango: Rango): string[] {
  return [
    fila([`Sevenz — ${apartado}`]),
    fila(["Negocio", nombreDelNegocio]),
    // EL RANGO RESUELTO VA ESCRITO, igual que en el de movimientos: una cifra
    // que alguien discuta tiene que poder comprobarse sin reconstruir qué
    // filtro estaba puesto.
    fila(["Periodo", `${aISO(rango.desde)} a ${aISO(rango.hasta)}`]),
    fila(["Generado", new Date().toISOString()]),
    fila([]),
  ];
}

export async function exportarInventario({
  supabase,
  ownerId,
  nombreDelNegocio,
  rango,
  rates,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  nombreDelNegocio: string;
  rango: Rango;
  rates: BolivarRates | null;
}): Promise<Exportacion | { motivo: MotivoDeFallo }> {
  let datos;
  try {
    datos = await cargarInventario({ supabase, ownerId, rango, rates });
  } catch (e) {
    console.error("[exportar-inventario]", e instanceof Error ? e.message : e);
    return { motivo: "lectura" };
  }

  const lineas = cabecera(nombreDelNegocio, "Inventario", rango);

  lineas.push(fila(["Resumen"]));
  lineas.push(fila(["Productos disponibles", datos.disponibles]));
  // SE DICE QUE UNO ESTÁ DENTRO DEL OTRO, igual que en la pantalla: sin esa
  // línea, quien sume las dos cifras en Excel se inventa un catálogo.
  lineas.push(fila(["Por agotarse (incluidos en los disponibles)", datos.porAgotarse]));
  lineas.push(fila(["Referencias agotadas", datos.agotadas]));
  lineas.push(fila(["Sin cantidad anotada", datos.sinContar]));
  lineas.push(fila(["Sin costo anotado", datos.sinCosto]));
  lineas.push(fila([]));

  // UNA FILA POR MONEDA Y NUNCA UNA SUMA, que es la regla de toda la app.
  lineas.push(fila(["Capital en inventario", "Moneda", "Importe"]));
  for (const d of datos.capitalPorMoneda) lineas.push(fila(["", d.currency, importe(d.amount)]));
  lineas.push(fila([]));
  lineas.push(fila(["Ventas proyectadas", "Moneda", "Importe"]));
  for (const d of datos.ventasProyectadas) lineas.push(fila(["", d.currency, importe(d.amount)]));
  lineas.push(fila([]));

  lineas.push(fila(["Producto", "Estado", "Cantidad", "Ganancia del periodo", "Moneda"]));
  // LOS DISPONIBLES YA INCLUYEN A LOS QUE ESTÁN POR AGOTARSE, así que esa
  // lista no se recorre aparte: saldrían dos veces.
  const todos = [...datos.disponiblesLista, ...datos.agotadasLista, ...datos.sinContarLista.map(
    (a): ProductoDeHoja => ({
      id: a.id,
      nombre: a.nombre,
      fotoPath: a.fotoPath,
      cantidad: null,
      ganancia: null,
    }),
  )];
  for (const p of todos) {
    lineas.push(
      fila([
        p.nombre,
        estado(p, datos.umbral),
        p.cantidad == null ? "" : p.cantidad,
        p.ganancia ? importe(p.ganancia.amount) : "",
        p.ganancia ? p.ganancia.currency : "",
      ]),
    );
  }

  return {
    csv: documento(lineas),
    nombre: "inventario",
    filas: todos.length,
  };
}

export async function exportarProveedores({
  supabase,
  ownerId,
  nombreDelNegocio,
  rango,
  rates,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  nombreDelNegocio: string;
  rango: Rango;
  rates: BolivarRates | null;
}): Promise<Exportacion | { motivo: MotivoDeFallo }> {
  let filas_;
  try {
    filas_ = await cargarProveedores({ supabase, ownerId, rango, rates });
  } catch (e) {
    console.error("[exportar-proveedores]", e instanceof Error ? e.message : e);
    return { motivo: "lectura" };
  }

  const lineas = cabecera(nombreDelNegocio, "Proveedores", rango);
  lineas.push(fila(["Proveedor", "Productos", "Margen %"]));
  for (const p of filas_) {
    // VACÍO Y NO CERO cuando no hay margen, igual que el «—» de la pantalla:
    // un 0 en una celda de Excel se suma y se promedia, y diría que ese
    // proveedor vende sin ganar nada.
    lineas.push(fila([p.nombre, p.productos, p.margenPct == null ? "" : importe(p.margenPct)]));
  }

  return { csv: documento(lineas), nombre: "proveedores", filas: filas_.length };
}
