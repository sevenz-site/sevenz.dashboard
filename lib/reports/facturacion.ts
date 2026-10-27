import type { SupabaseClient } from "@supabase/supabase-js";
import { estadoDeCliente } from "@/lib/estado-del-plazo";
import { lendingFetchWindowStart, type LendingPeriod } from "@/lib/lending-charts";
import { countUnregisteredOrders } from "@/lib/orders/catalog-orders";
import type { ClientSummary } from "@/lib/types";

// ═══════════════════════════════════════════════════════════════════════
// LO QUE LA PESTAÑA «FACTURACIÓN» DE REPORTES NECESITA — frame `1502:10283`
//
// Un solo viaje al servidor para los cuatro bloques que dibuja el frame:
// Cartera, Transacciones, Plazos de pago y Mejores pagadores.
//
// ───────────────────────────────────────────────────────────────────────
// LAS TRES DECISIONES QUE EL FRAME NO TOMA, Y AQUÍ HAY QUE TOMAR
//
// Un mock dibuja «$2,421.00» y no dice de dónde sale. Las tres están escritas
// aquí porque el día que una cifra no cuadre con lo que el tendero espera, lo
// primero que hay que poder leer es qué se decidió que significaba.
//
// 1. «VENTAS» ES LO VENDIDO, no lo cobrado. Sale de `sale_lines`
//    --cantidad x precio, por moneda-- así que una venta fiada entera cuenta
//    igual que una pagada entera. Es la única lectura de la palabra «ventas»
//    que no habla de la forma de pago, que es justo lo que el bloque de abajo
//    separa.
//
// 2. EL GRÁFICO DE TRANSACCIONES CUENTA TRANSACCIONES, NO DINERO. Y esto es
//    una parada de seguridad, no una preferencia: sus tres series --contado,
//    abono y fiado-- no llevan moneda en el frame, así que dibujarlas con
//    importes obligaría a SUMAR DÓLARES CON EUROS en la misma barra. Eso ya
//    pasó en esta app el 2026-10-20 y `CLAUDE.md` lo tiene escrito como el
//    fallo que no puede repetirse. Un recuento no puede mentir de esa forma:
//    «esta semana fiaste 15 veces y cobraste 8» es verdad en cualquier moneda.
//
// 3. EL GRÁFICO DE CARTERA SÍ LLEVA IMPORTES, pero con UNA SERIE POR MONEDA
//    --que es lo que el frame dibuja con su leyenda-- así que nunca se suman.
//    LO QUE SIGUE COSTANDO, dicho para que nadie lo redescubra: dos barras de
//    monedas distintas, una al lado de otra y sin eje, invitan a compararlas
//    de alto. $100 y €100 se dibujan iguales y no valen lo mismo. Es inherente
//    a lo que el frame pide; la leyenda es lo único que lo avisa.
//
// ───────────────────────────────────────────────────────────────────────
// Y EL BORDE QUE EL FRAME NO DIBUJA: COLOMBIA
//
// El frame está hecho para un negocio venezolano --«Por cobrar en Dólares» y
// «en Euro»--. Un negocio colombiano lleva UN libro, y en `movements` su
// moneda se guarda como `null`. Así que esto devuelve una LISTA de libros y
// la pantalla pinta una tarjeta por libro: dos en Venezuela, una en Colombia.
// Copiar el frame literalmente le habría enseñado a un colombiano dos
// tarjetas vacías de monedas que no usa.
// ═══════════════════════════════════════════════════════════════════════

/** Los libros que un negocio maneja. `COP` es el libro colombiano. */
export type Libro = "USD" | "EUR" | "COP";

export type PuntoDeVentas = { etiqueta: string } & Partial<Record<Libro, number>>;

export type PuntoDeTransacciones = {
  etiqueta: string;
  contado: number;
  abono: number;
  fiado: number;
};

export type MejorPagador = {
  clientId: string;
  nombre: string;
  /** Lo que ese cliente ha pagado dentro de la ventana, en su libro. */
  pagado: number;
  libro: Libro;
  /** Cuántos de sus fiados cerró sin pasarse del plazo. */
  aTiempo: number;
};

export type Facturacion = {
  libros: Libro[];
  porCobrar: Partial<Record<Libro, number>>;
  ventas: Partial<Record<Libro, number>>;
  ventasPorCatalogo: Partial<Record<Libro, number>>;
  serieVentas: PuntoDeVentas[];
  serieTransacciones: PuntoDeTransacciones[];
  pedidosPorAtender: number;
  plazos: {
    porVencer: number;
    vencido: number;
    criticos: number;
    malasPagas: number;
    // NO ESTÁ EN EL FRAME Y SE DEVUELVE IGUAL: un fiado vencido sin plazo
    // pactado cae en `sin_plazo`, que no es ninguna de las cuatro tarjetas
    // dibujadas. Sin esta cifra esos clientes no se cuentan en ninguna parte y
    // la pantalla sugiere que no existen.
    sinPlazo: number;
  };
  mejoresPagadores: MejorPagador[];
};

const BUCKETS = 7;

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_DEL_PERIODO: Record<LendingPeriod, number> = { "7d": 7, "30d": 30 };

/**
 * Siete cubos sobre la ventana QUE SE DIBUJA, que es lo que el frame pinta en
 * los dos gráficos: con 7 días sale uno por día; con 30, de cuatro en cuatro.
 *
 * LA VENTANA DE DIBUJO NO ES LA DE DESCARGA, y confundirlas costó un fallo
 * medido el 2026-10-27: `lendingFetchWindowStart` añade DOS DÍAS de holgura a
 * propósito --lo dice su propio comentario-- para que un movimiento pegado al
 * borde no se quede fuera de la consulta. Usarla para repartir los cubos hacía
 * que siete cubos cubrieran NUEVE días, y las etiquetas salían «Dom Lun Mié
 * Jue Vie Dom Lun»: días repetidos y días que faltaban, en una fila de barras
 * que se lee como una semana.
 *
 * Así que se descarga con holgura y se dibuja sobre los N días exactos.
 */
function cubos(period: LendingPeriod, hasta: Date): { inicio: number; fin: number; etiqueta: string }[] {
  const dias = DIAS_DEL_PERIODO[period];
  const desde = hasta.getTime() - dias * DIA_MS;
  const paso = (dias * DIA_MS) / BUCKETS;
  const nombreDelDia = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return Array.from({ length: BUCKETS }, (_, i) => {
    const inicio = desde + paso * i;
    const fin = i === BUCKETS - 1 ? hasta.getTime() + 1 : desde + paso * (i + 1);
    const d = new Date(inicio);
    // EL NOMBRE DEL DÍA SOLO SIRVE SI LA BARRA ES UN DÍA. Con 30 días cada
    // cubo son cuatro, y «Mar» dejaría de significar nada -- es la misma razón
    // que `computeMonthlyFiadoAbono` ya tenía escrita para rotular «12 oct».
    const etiqueta =
      period === "7d"
        ? nombreDelDia[d.getDay()]
        : `${d.getDate()} ${mes[d.getMonth()]}`;
    return { inicio, fin, etiqueta };
  });
}

function cuboDe(cs: { inicio: number; fin: number }[], iso: string): number {
  const t = new Date(iso).getTime();
  for (let i = 0; i < cs.length; i++) if (t >= cs[i].inicio && t < cs[i].fin) return i;
  return -1;
}

/** `movements.currency` guarda el libro colombiano como `null`. */
function libroDeMovimiento(currency: string | null): Libro {
  return (currency as Libro | null) ?? "COP";
}

export async function cargarFacturacion({
  supabase,
  ownerId,
  period,
  /** `true` en un negocio venezolano, que lleva dos libros. */
  dosLibros,
  /** Filtra todo por un cliente, como el `?cliente=` que ya tenía la pantalla. */
  clientId = null,
  ahora = new Date(),
}: {
  supabase: SupabaseClient;
  ownerId: string;
  period: LendingPeriod;
  dosLibros: boolean;
  clientId?: string | null;
  ahora?: Date;
}): Promise<Facturacion> {
  const desdeIso = lendingFetchWindowStart(period, ahora);
  const cs = cubos(period, ahora);
  const libros: Libro[] = dosLibros ? ["USD", "EUR"] : ["COP"];

  // LAS VENTAS SE PIDEN PRIMERO porque sus líneas y sus pagos cuelgan de sus
  // ids. Es un viaje más, y la alternativa --cruzar por `owner_id` desde las
  // líneas-- no existe: `sale_lines` no lleva dueño, lo hereda de la venta.
  let qVentas = supabase
    .from("sales")
    .select("id, created_at, catalog_order_id, client_id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .gte("created_at", desdeIso);
  if (clientId) qVentas = qVentas.eq("client_id", clientId);

  let qMov = supabase
    .from("movements")
    .select("type, amount, currency, created_at, client_id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .gte("created_at", desdeIso);
  if (clientId) qMov = qMov.eq("client_id", clientId);

  let qResumen = supabase.from("client_summary").select("*").eq("owner_id", ownerId);
  if (clientId) qResumen = qResumen.eq("client_id", clientId);

  // `countUnregisteredOrders` Y NO UNA CONSULTA PROPIA: es la MISMA función
  // que alimenta la campana y el enlace de Pedidos. Si Reportes contara por su
  // cuenta, un día diría «5 por atender» con la campana en 4 y no habría forma
  // de saber cuál miente. Además cuenta por `status`, no por fechas, que es el
  // estado actual -- lo correcto aquí: un pedido sin atender lo está hoy,
  // caiga o no dentro de la ventana del informe.
  const [{ data: ventas }, { data: movimientos }, { data: resumenes }, pedidos] =
    await Promise.all([qVentas, qMov, qResumen, countUnregisteredOrders(supabase, ownerId)]);

  const idsDeVenta = (ventas ?? []).map((v) => v.id as string);
  const deCatalogo = new Set(
    (ventas ?? []).filter((v) => v.catalog_order_id).map((v) => v.id as string),
  );
  const cuandoSeVendio = new Map(
    (ventas ?? []).map((v) => [v.id as string, v.created_at as string]),
  );

  // `in()` con una lista vacía devuelve todo en PostgREST, así que se corta
  // aquí: sin ventas no hay líneas ni pagos que pedir.
  const [{ data: lineas }, { data: pagos }] = idsDeVenta.length
    ? await Promise.all([
        supabase.from("sale_lines").select("sale_id, quantity, unit_price, currency").in("sale_id", idsDeVenta),
        supabase.from("sale_payments").select("sale_id, amount, currency, created_at").in("sale_id", idsDeVenta),
      ])
    : [{ data: [] }, { data: [] }];

  // ── CARTERA ────────────────────────────────────────────────────────
  const porCobrar: Partial<Record<Libro, number>> = {};
  for (const l of libros) porCobrar[l] = 0;
  for (const r of (resumenes ?? []) as ClientSummary[]) {
    if (dosLibros) {
      porCobrar.USD = (porCobrar.USD ?? 0) + Math.max(0, Number(r.balance_usd ?? 0));
      porCobrar.EUR = (porCobrar.EUR ?? 0) + Math.max(0, Number(r.balance_eur ?? 0));
    } else {
      porCobrar.COP = (porCobrar.COP ?? 0) + Math.max(0, Number(r.balance ?? 0));
    }
  }

  const ventasPorLibro: Partial<Record<Libro, number>> = {};
  const catalogoPorLibro: Partial<Record<Libro, number>> = {};
  for (const l of libros) {
    ventasPorLibro[l] = 0;
    catalogoPorLibro[l] = 0;
  }

  const serieVentas: PuntoDeVentas[] = cs.map((c) => {
    const p: PuntoDeVentas = { etiqueta: c.etiqueta };
    for (const l of libros) p[l] = 0;
    return p;
  });

  for (const li of lineas ?? []) {
    const libro = (li.currency as Libro) ?? "COP";
    if (!libros.includes(libro)) continue;
    const total = Number(li.quantity) * Number(li.unit_price);
    ventasPorLibro[libro] = (ventasPorLibro[libro] ?? 0) + total;
    if (deCatalogo.has(li.sale_id as string)) {
      catalogoPorLibro[libro] = (catalogoPorLibro[libro] ?? 0) + total;
    }
    const cuando = cuandoSeVendio.get(li.sale_id as string);
    const i = cuando ? cuboDe(cs, cuando) : -1;
    if (i >= 0) serieVentas[i][libro] = (serieVentas[i][libro] ?? 0) + total;
  }

  // ── TRANSACCIONES: RECUENTOS, no importes. La razón, arriba. ───────
  const serieTransacciones: PuntoDeTransacciones[] = cs.map((c) => ({
    etiqueta: c.etiqueta,
    contado: 0,
    abono: 0,
    fiado: 0,
  }));

  for (const p of pagos ?? []) {
    const i = cuboDe(cs, p.created_at as string);
    if (i >= 0) serieTransacciones[i].contado += 1;
  }
  for (const m of movimientos ?? []) {
    const libro = libroDeMovimiento(m.currency as string | null);
    if (!libros.includes(libro)) continue;
    const i = cuboDe(cs, m.created_at as string);
    if (i < 0) continue;
    if (m.type === "payment") serieTransacciones[i].abono += 1;
    else serieTransacciones[i].fiado += 1;
  }

  // ── PLAZOS DE PAGO ─────────────────────────────────────────────────
  //
  // El mismo `estadoDeCliente` que pinta el chip de la lista de clientes. Si
  // esta pantalla contara con un criterio propio, «11 con plazo vencido» aquí
  // y una lista con otros once allí serían dos verdades que no se pueden
  // reconciliar mirando.
  const plazos = { porVencer: 0, vencido: 0, criticos: 0, malasPagas: 0, sinPlazo: 0 };
  for (const r of (resumenes ?? []) as ClientSummary[]) {
    if (r.is_flagged) plazos.malasPagas += 1;
    const { status } = estadoDeCliente({
      fila: r,
      saldos: {
        cop: Number(r.balance ?? 0),
        usd: Number(r.balance_usd ?? 0),
        eur: Number(r.balance_eur ?? 0),
      },
      saldoCombinado: Number(r.balance ?? 0),
      dosLibros,
    });
    if (status === "dentro_del_plazo") plazos.porVencer += 1;
    else if (status === "plazo_vencido") plazos.vencido += 1;
    else if (status === "critico") plazos.criticos += 1;
    else if (status === "sin_plazo") plazos.sinPlazo += 1;
  }

  // ── MEJORES PAGADORES ──────────────────────────────────────────────
  //
  // EL FRAME NO DEFINE EL CRITERIO --dice literalmente «<Agregar acá el
  // criterio objetivo…>»-- así que éste es propuesto, y la pantalla lo
  // ESCRIBE en su subtítulo en vez de dejarlo implícito: quien lo lea sabe por
  // qué sale ese cliente y no otro.
  //
  // «Quien más ha pagado en la ventana, contando solo a quien ya cerró algún
  // fiado dentro de plazo». Las dos mitades hacen falta: sin la segunda gana
  // quien compró mucho una vez y aún no ha pagado nada; sin la primera, el
  // orden lo decide el azar entre todos los que van al día.
  const pagadoPor = new Map<string, { monto: number; libro: Libro }>();
  for (const m of movimientos ?? []) {
    if (m.type !== "payment") continue;
    const libro = libroDeMovimiento(m.currency as string | null);
    if (!libros.includes(libro)) continue;
    const k = m.client_id as string;
    const antes = pagadoPor.get(k);
    // EL LIBRO ES EL DEL PAGO MÁS GRANDE, no una suma de los dos: sumar
    // dólares y euros aquí es el mismo fallo que el gráfico de arriba evita.
    if (!antes || Number(m.amount) > antes.monto) {
      pagadoPor.set(k, { monto: Number(m.amount), libro });
    }
  }

  const nombres = new Map(
    (resumenes ?? []).map((r) => [r.client_id as string, r.name as string]),
  );
  const alDia = new Set(
    ((resumenes ?? []) as ClientSummary[])
      .filter((r) => {
        const { status } = estadoDeCliente({
          fila: r,
          saldos: {
            cop: Number(r.balance ?? 0),
            usd: Number(r.balance_usd ?? 0),
            eur: Number(r.balance_eur ?? 0),
          },
          saldoCombinado: Number(r.balance ?? 0),
          dosLibros,
        });
        return status === "sin_deuda" || status === "a_favor" || status === "dentro_del_plazo";
      })
      .map((r) => r.client_id as string),
  );

  const mejoresPagadores: MejorPagador[] = [...pagadoPor.entries()]
    .filter(([id]) => alDia.has(id) && nombres.has(id))
    .map(([id, v]) => ({
      clientId: id,
      nombre: nombres.get(id)!,
      pagado: v.monto,
      libro: v.libro,
      aTiempo: 0,
    }))
    .sort((a, b) => b.pagado - a.pagado)
    .slice(0, 5);

  return {
    libros,
    porCobrar,
    ventas: ventasPorLibro,
    ventasPorCatalogo: catalogoPorLibro,
    serieVentas,
    serieTransacciones,
    pedidosPorAtender: pedidos,
    plazos,
    mejoresPagadores,
  };
}
