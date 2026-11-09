import type { createClient } from "@/lib/supabase/server";
import { readAllByIds, readAllPages } from "@/lib/supabase/read-all";
import type { Rango } from "@/lib/reports/rango";
import { cargarDevoluciones } from "@/lib/reports/devoluciones";
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

// ───────────────────────────────────────────────────────────────────────
// LA FÓRMULA, PARA AUDITARLA SIN LEER EL ARCHIVO
//
//   Ventas del periodo (la tarjeta «Ventas» del Inicio)
//     Σ `sale_payments.amount` de los pares (venta, libro) que NO dejaron
//     cargo en `movements`, de las ventas del rango. O sea: lo cobrado de
//     contado, por libro.
//
//   ES LA MISMA CIFRA QUE «Ventas» DE REPORTES, calculada aquí por segunda
//   vez a propósito --Reportes la saca en el mismo recorrido con el que arma
//   sus gráficos-- y atada a ella por `npm run qa:ventas-inicio`, que falla
//   si difieren un céntimo. La tarjeta del Inicio ENLAZA a Reportes: si las
//   dos se separaran, el tendero tocaría la tarjeta y el número cambiaría.
//
//   LO QUE NO CUENTA: los fiados, y el abono que el cliente paga al fiar.
//   Eso último sale en «Abonos» de Reportes y no tiene tarjeta en el Inicio.
// ───────────────────────────────────────────────────────────────────────

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
  // The paged reads throw on any page's error; same messages as before.
  const conNombre = <T,>(que: string, p: Promise<T>) =>
    p.catch((e: Error) => {
      throw new Error(`${que}: ${e.message}`);
    });

  // PL-34: every row, not the first 1,000 (lib/supabase/read-all.ts).
  // SE MIRA EL ERROR. Descartarlo pondría un «$0,00» en el Inicio de un
  // negocio que vendió -- un cero creíble, que es el fallo que costó un día
  // entero en Reportes el 2026-10-27.
  const ventas = await conNombre(
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
  );

  const ids = ventas.map((v) => v.id as string);

  // THE MONEY THAT WENT BACK from cash sales, on the day it went back. Read
  // first and not after the early return below: a day with no sales can still
  // have a return. Why only `to_cash`: `devoluciones.ts`.
  const devuelto: Partial<Record<Libro, number>> = {};
  const devoluciones = await cargarDevoluciones(supabase, {
    ownerId,
    desdeIso: rango.desde.toISOString(),
    hastaIso: rango.hasta.toISOString(),
  });
  for (const d of devoluciones) {
    if (d.fromFiado || d.toCash <= 0) continue;
    const libro = d.currency as Libro;
    devuelto[libro] = (devuelto[libro] ?? 0) + d.toCash;
  }

  // Un `in()` vacío en PostgREST devuelve TODO en vez de nada, que aquí
  // sería el libro de otro negocio.
  if (!ids.length) {
    return Object.fromEntries(Object.entries(devuelto).map(([l, n]) => [l, -n]));
  }

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
  // PL-34: every row, not the first 1,000 (lib/supabase/read-all.ts).
  const [pagos, cargos] = await Promise.all([
    conNombre(
      "ventas: pagos",
      readAllByIds<Record<string, unknown>>(ids, (batch, from, to) =>
        supabase
          .from("sale_payments")
          .select("sale_id, amount, currency", { count: "exact" })
          .in("sale_id", batch)
          .order("id")
          .range(from, to),
      ),
    ),
    // Los cargos dicen qué par (venta, libro) quedó fiado. Sin filtro de
    // fecha a propósito: la pregunta es sobre ESTAS ventas, no sobre el
    // periodo, y un cargo que cayera un segundo fuera convertiría un fiado
    // en una venta de contado.
    conNombre(
      "ventas: cargos",
      readAllByIds<Record<string, unknown>>(ids, (batch, from, to) =>
        supabase
          .from("movements")
          .select("sale_id, currency, type, paid_with_credit", { count: "exact" })
          .in("sale_id", batch)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
    ),
  ]);

  const librosFiados = new Set(
    (cargos ?? [])
      // Settled with saldo a favor (migration 185): nothing was lent.
      .filter((m) => m.type === "charge" && !m.paid_with_credit)
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
  for (const [l, n] of Object.entries(devuelto)) {
    porLibro[l as Libro] = (porLibro[l as Libro] ?? 0) - n;
  }
  return porLibro;
}
