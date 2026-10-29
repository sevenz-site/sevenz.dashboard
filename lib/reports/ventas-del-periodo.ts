import type { createClient } from "@/lib/supabase/server";
import type { Rango } from "@/lib/reports/rango";
import { claveDeFila, libroDeVenta } from "@/lib/ventas-de-contado";

// ═══════════════════════════════════════════════════════════════════════
// LO QUE SE VENDIÓ EN UN PERIODO, POR LIBRO
//
// Nació el 2026-10-28 para la tarjeta «Ventas» del Inicio (frame
// `1500:9981`), que el dueño decidió que enseñara **los últimos 30 días** —
// el mismo periodo con el que abre Reportes, *«la única opción en la que las
// dos pantallas no se contradicen»*.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ CUENTA COMO «VENTA», Y NO ES LO COBRADO
//
// Es el VALOR de las líneas vendidas --cantidad × precio-- y no el dinero
// que entró. Un fiado de $100 cuenta $100 el día que se fía, aunque no se
// haya cobrado nada: la pregunta que contesta esta cifra es «cuánto despaché»,
// no «cuánto tengo en caja». Lo segundo es «Por cobrar», que es la tarjeta de
// al lado y por eso no se pisan.
//
// POR LIBRO Y NUNCA SUMADO. La moneda la lleva la LÍNEA, no la venta: una
// venta mixta --dólares cobrados y euros fiados-- reparte sus líneas entre
// los dos libros. Sumarlos sería el error que esta app no ha cometido nunca.
//
// ───────────────────────────────────────────────────────────────────────
// ESTO TIENE QUE DAR LO MISMO QUE REPORTES, Y HAY UNA PRUEBA QUE LO EXIGE
//
// `cargarFacturacion` calcula su propia cifra de ventas en el mismo recorrido
// que arma el gráfico por días y lo que viene del catálogo, así que no puede
// llamar a esta función sin dar un paseo de más por las mismas filas.
//
// O sea que **hay dos implementaciones de la misma cifra**, que es justo lo
// que este repo tiene escrito que se separa. La defensa es `npm run
// qa:ventas-inicio`: compara las dos sobre los datos de dev y falla si
// difieren un céntimo. Es el mismo arreglo que `qa:puntaje` para el puntaje de
// crédito, y por la misma razón — dos cuentas de lo mismo en dos lenguajes se
// separaron una vez y nadie se entera hasta que alguien las compara.
// ═══════════════════════════════════════════════════════════════════════

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type Libro = "USD" | "EUR" | "COP";

export async function ventasDelPeriodo({
  supabase,
  ownerId,
  rango,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  rango: Rango;
}): Promise<Partial<Record<Libro, number>>> {
  const { data: ventas, error: errorVentas } = await supabase
    .from("sales")
    .select("id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .gte("created_at", rango.desde.toISOString())
    .lte("created_at", rango.hasta.toISOString());
  // SE MIRA EL ERROR. Descartarlo pondría un «$0,00» en el Inicio de un
  // negocio que vendió -- un cero creíble, que es el fallo que costó un día
  // entero en Reportes el 2026-10-27.
  if (errorVentas) throw new Error(`ventas: ${errorVentas.message}`);

  const ids = (ventas ?? []).map((v) => v.id as string);
  // Un `in()` vacío en PostgREST devuelve TODO en vez de nada, que aquí
  // sería el libro de otro negocio.
  if (!ids.length) return {};

  // ── LO COBRADO DE CONTADO, NO LO VENDIDO ─────────────────────────────
  //
  // Cambió el 2026-10-29 con la decisión del dueño sobre qué significa
  // «Ventas» --*«son todas las transacciones de tipo De contado»*--. Antes
  // esto sumaba `sale_lines` (cantidad × precio, con los fiados dentro).
  //
  // CAMBIA AQUÍ PORQUE NO PUEDE NO CAMBIAR: esta es la SEGUNDA
  // implementación de la misma cifra, la del Inicio, y la tarjeta del Inicio
  // enlaza a Reportes. Si solo cambiara Reportes, el tendero tocaría la
  // tarjeta y el número cambiaría delante de sus ojos. Es exactamente lo que
  // `npm run qa:ventas-inicio` existe para impedir.
  const [{ data: pagos, error: errorPagos }, { data: cargos, error: errorCargos }] =
    await Promise.all([
      supabase.from("sale_payments").select("sale_id, amount, currency").in("sale_id", ids),
      // Los cargos dicen qué par (venta, libro) quedó fiado. Sin filtro de
      // fecha a propósito: la pregunta es sobre ESTAS ventas, no sobre el
      // periodo, y un cargo que cayera un segundo fuera convertiría un fiado
      // en una venta de contado.
      supabase
        .from("movements")
        .select("sale_id, currency, type")
        .in("sale_id", ids)
        .is("deleted_at", null),
    ]);
  if (errorPagos) throw new Error(`ventas: pagos: ${errorPagos.message}`);
  if (errorCargos) throw new Error(`ventas: cargos: ${errorCargos.message}`);

  const librosFiados = new Set(
    (cargos ?? [])
      .filter((m) => m.type !== "payment")
      .map((m) => claveDeFila(m.sale_id as string, (m.currency as "USD" | "EUR" | null) ?? null)),
  );

  const porLibro: Partial<Record<Libro, number>> = {};
  for (const pg of pagos ?? []) {
    // Un pago de un libro que dejó cargo es un ABONO dentro de un fiado, no
    // una venta de contado. Esa mitad la enseña Reportes en su propia
    // tarjeta; aquí simplemente no cuenta.
    if (librosFiados.has(claveDeFila(pg.sale_id as string, libroDeVenta(pg.currency as string)))) {
      continue;
    }
    // El libro colombiano se guarda como `null` en `movements` y como `'COP'`
    // en `sale_payments`. Aquí llega ya como 'COP', pero el `?? "COP"` cubre
    // una fila sin moneda sin dejarla fuera de la cuenta en silencio.
    const libro = ((pg.currency as Libro | null) ?? "COP") as Libro;
    porLibro[libro] = (porLibro[libro] ?? 0) + Number(pg.amount);
  }
  return porLibro;
}
