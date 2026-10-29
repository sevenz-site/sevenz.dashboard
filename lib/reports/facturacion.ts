import type { SupabaseClient } from "@supabase/supabase-js";
import { estadoDeCliente } from "@/lib/estado-del-plazo";
import { diasDelRango, type Rango } from "@/lib/reports/rango";
import { countUnregisteredOrders, pendingOrdersMoney } from "@/lib/orders/catalog-orders";
import { claveDeFila, libroDeVenta } from "@/lib/ventas-de-contado";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import type { EffectiveRate } from "@/lib/exchange-rate/convert";
import type { ClientStatus, ClientSummary } from "@/lib/types";

// ═══════════════════════════════════════════════════════════════════════
// LO QUE LA PESTAÑA «FACTURACIÓN» DE REPORTES NECESITA — frame `1502:10283`
//
// Un solo viaje al servidor para los cuatro bloques que dibuja el frame:
// Cartera, Transacciones, Plazos de pago y Mejores pagadores.
//
// ───────────────────────────────────────────────────────────────────────
// LAS FÓRMULAS, UNA POR UNA — para auditar sin leer el archivo entero
//
// Encargo del dueño el 2026-10-29: *«documenta en el código las fórmulas como
// quedaron para que en un futuro (…) alguien más pueda auditar sin problema»*.
//
// ESTA TABLA DICE LO QUE EL CÓDIGO HACE, no lo que la pantalla promete. Donde
// las dos cosas no coinciden se dice, porque es justo lo que una auditoría
// tiene que poder encontrar.
//
//   Por cobrar en X
//     Σ max(0, saldo del cliente en X) sobre `client_summary`.
//     SIN FILTRO DE FECHA: es el saldo de HOY, acumulado desde siempre.
//     Un saldo A FAVOR cuenta como 0, no resta (decisión del dueño,
//     2026-10-29: la cifra responde «cuánto hay que salir a cobrar»).
//
//   Ventas en X
//     Σ `sale_payments.amount` de los pares (venta, libro) que NO dejaron
//     cargo en `movements`. O sea: lo cobrado de contado. Ver la decisión 1.
//
//   Gráfico «Ventas»
//     Lo mismo, repartido en 7 cubos por la FECHA DE LA VENTA (no la del
//     pago). La suma de las barras es la cifra de la tarjeta.
//
//   Gráfico «Transacciones»
//     RECUENTOS, no importes.
//       contado = nº de pares (venta, libro) que NO dejaron cargo. Es la
//                 misma definición de «de contado» que usa la tarjeta
//                 «Ventas» y que el historial del cliente. Una venta mixta
//                 suma 1 aquí Y 1 en fiado, porque son dos tarjetas en el
//                 historial. Los pedidos del catálogo entran solos: se
//                 registran creando una venta normal.
//       abono   = nº de `movements` con type='payment'.
//       fiado   = nº de `movements` que no son 'payment'.
//
//   Transacciones por catálogo en X
//     Σ cantidad × precio de las `sale_lines` de las ventas que vienen de un
//     pedido (`catalog_order_id`). INCLUYE fiados y contado, así que puede
//     salir MAYOR que «Ventas».
//
//   Abonos en X
//     Σ `movements.amount` con type='payment'  +  Σ `sale_payments.amount`
//     de los pares (venta, libro) que SÍ dejaron cargo.
//     La segunda mitad es lo que el cliente pagó AL FIAR, que no escribe
//     movimiento de abono. Disjunto de «Ventas» por construcción.
//
//   Fiados en X
//     Σ `movements.amount` de los que NO son type='payment', en el rango.
//
//   Pedidos por atender / Dinero por atender
//     `countUnregisteredOrders` y `pendingOrdersMoney`, las MISMAS que
//     alimentan la campana. SIN FILTRO DE FECHA: es el estado de hoy. El
//     dinero se enseña en la moneda mayor, nunca sumado.
//
//   Plazos de pago (4 tarjetas + «sin plazo»)
//     Recuento de clientes por `estadoDeCliente`, el MISMO juez que pinta el
//     chip de la lista de clientes. SIN FILTRO DE FECHA. «Mala paga» es una
//     marca y no un estado, así que un cliente puede salir en dos listas.
//     El importe que acompaña es el del libro que decidió el estado.
//
//   Mejores pagadores
//     Orden por PUNTAJE DE CRÉDITO, de mayor a menor, los 5 primeros.
//     El puntaje sale de `computeCreditScoresForClients`, el mismo que
//     Cartera; mide toda la historia del cliente, así que esta tarjeta NO
//     depende del rango elegido. Quedan fuera los «Sin historial»: un cliente
//     sin fiados cerrados no es un buen pagador, es un desconocido.
//     A igualdad de puntaje manda el nombre, para que el orden sea estable.
//
//   TODAS las cifras del rango descartan los DOS DÍAS de holgura que la
//   consulta pide de más por cada punta. Ver `cubos()`.
//
// ───────────────────────────────────────────────────────────────────────
// LAS TRES DECISIONES QUE EL FRAME NO TOMA, Y AQUÍ HAY QUE TOMAR
//
// Un mock dibuja «$2,421.00» y no dice de dónde sale. Las tres están escritas
// aquí porque el día que una cifra no cuadre con lo que el tendero espera, lo
// primero que hay que poder leer es qué se decidió que significaba.
//
// 1. «VENTAS» ES LO COBRADO DE CONTADO. Decisión del dueño el 2026-10-29,
//    al auditar cómo se calculaba cada métrica: *«son todas las transacciones
//    de tipo De contado»*.
//
//    ESTO DESPLAZA LO QUE DECÍA AQUÍ, y la razón vieja se queda escrita
//    porque sigue siendo cierta y es lo que se cede: «Ventas» era LO VENDIDO
//    --`sale_lines`, cantidad × precio-- o sea la única lectura de la palabra
//    que no habla de la forma de pago. Era decisión mía, del 2026-10-27, no
//    suya.
//
//    LO QUE CUESTA, medido en dev antes de cambiarlo: la cifra cae un 88 %,
//    de $13.161,50 a $1.556,00. No es una pérdida de datos -- es otra
//    pregunta. El subtítulo de la tarjeta lo dice, porque una caída así sin
//    explicación se lee como que la app se rompió.
//
//    Y DEJA UN AGUJERO QUE HAY QUE TAPAR: el abono que el cliente paga AL
//    FIAR no es contado --su libro dejó cargo-- ni está por cobrar --ya se
//    pagó--. Por eso existen las tarjetas «Abonos en X», que lo recogen. La
//    invariante que lo prueba: `ventas + abonos` = todo lo que entró por caja
//    en el periodo.
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

/** Un cliente dentro de una de las cuatro hojas de «Plazos de pago». */
export type ClienteDePlazo = {
  clientId: string;
  nombre: string;
  /** Lo que debe en SU libro, nunca una suma de los dos. */
  monto: number;
  libro: Libro;
  status: ClientStatus;
  /** La marca de «mala paga», que NO es un estado: va en su propio chip. */
  marcado: boolean;
  /** Cuándo vence --o venció-- su fiado más grave. ISO, o `null` si no tiene. */
  venceEl: string | null;
};

export type MejorPagador = {
  clientId: string;
  nombre: string;
  /** Su puntaje de crédito, 0-1000. Es lo que ordena la lista. */
  puntaje: number;
  /** El nivel que acompaña al puntaje: «Excelente», «Bueno»… */
  nivel: string;
};

export type Facturacion = {
  libros: Libro[];
  porCobrar: Partial<Record<Libro, number>>;
  /**
   * Lo cobrado de contado en el periodo. Ver la decisión 1 de la cabecera.
   *
   * SON LOS PAGOS DE LOS LIBROS SIN CARGO, no las líneas vendidas: un par
   * (venta, libro) que dejó cargo en `movements` es fiado entero, y sus pagos
   * se van a `abonos`.
   */
  ventas: Partial<Record<Libro, number>>;
  /**
   * Lo que el cliente pagó sobre una deuda: los abonos posteriores MÁS lo que
   * pagó al fiar.
   *
   * LAS DOS MITADES, y la segunda sorprende: un fiado con abono inicial
   * escribe un cargo por LO QUE QUEDA y guarda lo pagado en `sale_payments`,
   * sin escribir ningún movimiento de abono. Así que contar solo
   * `movements.type = 'payment'` dejaba ese dinero fuera de toda la pantalla.
   * Decisión del dueño el 2026-10-29, preguntado con la cifra delante.
   *
   * NO PUEDE HABER DOBLE CONTEO: un pago va a `ventas` si su libro no dejó
   * cargo y a `abonos` si lo dejó. Los dos conjuntos son disjuntos por
   * construcción, no por un filtro que alguien pueda quitar.
   */
  abonos: Partial<Record<Libro, number>>;
  /** Lo fiado en el periodo: la suma de los cargos, por libro. */
  fiados: Partial<Record<Libro, number>>;
  ventasPorCatalogo: Partial<Record<Libro, number>>;
  serieVentas: PuntoDeVentas[];
  serieTransacciones: PuntoDeTransacciones[];
  pedidosPorAtender: number;
  // LO QUE ESE DINERO VALE, en su moneda más grande. `null` cuando no hay
  // pedidos o cuando ninguno tiene líneas vivas. Por qué «la mayor» y no una
  // suma: ver `pendingOrdersMoney`.
  dineroPorAtender: { currency: string; amount: number } | null;
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
  // LOS CLIENTES DE CADA TARJETA, que es lo que abre su hoja (frames
  // `1667:20645`, `1667:21438`, `1667:21230` y `1667:21622`).
  //
  // VIAJAN ENTEROS AL NAVEGADOR y no por página: la hoja lleva su propio
  // buscador, así que filtrar en el servidor pediría un viaje por letra
  // tecleada. Son cuatro campos por cliente; con los 214 de producción son
  // unos pocos KB. El día que un negocio tenga miles, esto se nota antes que
  // nada y el arreglo es buscar en el servidor.
  clientesPorPlazo: Record<ClavePlazo, ClienteDePlazo[]>;
  mejoresPagadores: MejorPagador[];
  // ── ¿ESTE NEGOCIO NO HA REGISTRADO NADA, NUNCA? ──────────────────────
  //
  // Lo decide qué dice un estado vacío, y por eso es un dato y no una
  // suposición. El frame `1762:14809` escribe «Aún no hay clientes, ventas ni
  // abonos registrados», y eso es VERDAD en un negocio recién abierto y
  // FALSO en uno con cuarenta clientes al día y cero malas pagas -- que es la
  // mejor noticia posible y donde esa frase se lee como que la app perdió los
  // datos. Decisión del dueño el 2026-10-27: dos textos según el caso.
  //
  // SE MIDE POR LOS CLIENTES Y NO POR LOS MOVIMIENTOS DEL RANGO, que es la
  // trampa: un negocio con tres años de historia y una semana floja tiene
  // CERO movimientos en el rango y no está vacío ni de lejos. La lista de
  // clientes no lleva filtro de fecha, así que contesta la pregunta de
  // verdad. Y basta con ella: sin un solo cliente no puede haber fiados ni
  // abonos, y hasta una venta de contado crea su «Mostrador».
  //
  // Sale gratis: esa consulta ya se hacía para resolver los ids.
  negocioSinNada: boolean;
};

export type ClavePlazo = "porVencer" | "vencido" | "criticos" | "malasPagas" | "sinPlazo";

const BUCKETS = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Siete cubos sobre el rango QUE SE DIBUJA, que es lo que el frame pinta en
 * los dos gráficos.
 *
 * LA VENTANA DE DIBUJO NO ES LA DE DESCARGA, y confundirlas costó un fallo
 * medido el 2026-10-27: se repartían los cubos sobre la ventana de consulta,
 * que lleva DOS DÍAS de holgura a propósito para que un movimiento pegado al
 * borde no se quede fuera. Siete cubos cubrían nueve días y las etiquetas
 * salían «Dom Lun Mié Jue Vie Dom Lun»: días repetidos y días que faltaban,
 * en una fila de barras que se lee como una semana.
 */
function cubos(rango: Rango): { inicio: number; fin: number; etiqueta: string }[] {
  const dias = diasDelRango(rango);
  const desde = rango.desde.getTime();
  const total = rango.hasta.getTime() - desde;
  const paso = total / BUCKETS;
  const nombreDelDia = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return Array.from({ length: BUCKETS }, (_, i) => {
    const inicio = desde + paso * i;
    const fin = i === BUCKETS - 1 ? rango.hasta.getTime() + 1 : desde + paso * (i + 1);
    const d = new Date(inicio);
    // EL NOMBRE DEL DÍA SOLO SIRVE SI LA BARRA ES UN DÍA. Con un rango largo
    // cada cubo son varios y «Mar» dejaría de significar nada -- es la misma
    // razón que `computeMonthlyFiadoAbono` ya tenía escrita para rotular
    // «12 oct». El corte en 8 y no en 7 deja que una semana justa --que es el
    // rango que más se mira-- siga rotulando con días.
    //
    // ── Y CON UN SOLO DÍA LA BARRA ES UNA HORA, NO UN DÍA ──────────────
    //
    // El atajo «Hoy», que nació el 2026-10-29, parte 24 horas en los mismos 7
    // cubos. Con la regla de arriba los siete salían rotulados «Jue»: siete
    // etiquetas idénticas bajo siete barras distintas, que es peor que no
    // tener etiqueta -- sugiere que la fila es de siete jueves.
    //
    // SE ROTULA LA HORA DE INICIO DEL CUBO, redondeada. Con 24 h entre 7
    // cubos cada uno dura 3 h 26 min, así que las horas no salen redondas
    // --0, 3, 7, 10, 14, 17, 21-- y eso es correcto: son los cortes de
    // verdad, no una rejilla inventada.
    const etiqueta =
      dias === 1
        ? `${d.getHours()}h`
        : dias <= 8
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
  rango,
  /** `true` en un negocio venezolano, que lleva dos libros. */
  dosLibros,
  /**
   * La tasa efectiva del dueño, para el PUNTAJE de «Mejores pagadores».
   *
   * Solo la usa el saldo combinado que entra en el puntaje, que es como
   * `computeCreditScoresForClients` la pide desde Cartera. `null` en un
   * negocio colombiano, que lleva un solo libro.
   */
  effectiveRate = null,
  /** Filtra todo por un cliente, como el `?cliente=` que ya tenía la pantalla. */
  clientId = null,
}: {
  supabase: SupabaseClient;
  ownerId: string;
  rango: Rango;
  dosLibros: boolean;
  effectiveRate?: EffectiveRate | null;
  clientId?: string | null;
}): Promise<Facturacion> {
  // DOS DÍAS DE HOLGURA EN LA CONSULTA, y ni uno en el dibujo. Los cubos
  // reparten el rango exacto; la consulta pide un poco más por los bordes,
  // que es la misma razón que `lendingFetchWindowStart` ya tenía escrita.
  const desdeIso = new Date(rango.desde.getTime() - 2 * DIA_MS).toISOString();
  const hastaIso = new Date(rango.hasta.getTime() + 2 * DIA_MS).toISOString();
  const cs = cubos(rango);
  const libros: Libro[] = dosLibros ? ["USD", "EUR"] : ["COP"];

  // LAS VENTAS SE PIDEN PRIMERO porque sus líneas y sus pagos cuelgan de sus
  // ids. Es un viaje más, y la alternativa --cruzar por `owner_id` desde las
  // líneas-- no existe: `sale_lines` no lleva dueño, lo hereda de la venta.
  let qVentas = supabase
    .from("sales")
    .select("id, created_at, catalog_order_id, client_id")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .gte("created_at", desdeIso)
    .lte("created_at", hastaIso);
  if (clientId) qVentas = qVentas.eq("client_id", clientId);

  let qResumen = supabase.from("client_summary").select("*").eq("owner_id", ownerId);
  if (clientId) qResumen = qResumen.eq("client_id", clientId);

  // ── `movements` NO LLEVA `owner_id`. SE LLEGA POR EL CLIENTE ────────
  //
  // Lo tuve escrito como `.eq("owner_id", ownerId)` y esa columna NO EXISTE
  // (`supabase/schema.sql:131`): un movimiento pertenece a un cliente, y el
  // cliente a un dueño. La consulta devolvía error, el error se descartaba al
  // desestructurar solo `{ data }`, y `movimientos` llegaba `null`.
  //
  // QUÉ COSTÓ, medido en dev el 2026-10-27 contra la base: el gráfico de
  // Transacciones decía 0 fiados y 0 abonos donde había **34 y 50**, y
  // «Mejores pagadores» salía vacío SIEMPRE. No fallaba nada en pantalla --
  // eran ceros creíbles, que es el fallo que este repo tiene escrito como el
  // que no avisa. Lo di por plausible al probarlo.
  //
  // EL PATRÓN BUENO YA EXISTÍA en `lib/weekly-lending-read.ts`: se resuelven
  // los clientes del dueño y se filtra por ellos.
  const { data: clientesDelDueno, error: errorClientes } = await supabase
    .from("clients")
    .select("id")
    .eq("owner_id", ownerId);
  if (errorClientes) throw new Error(`reportes: clientes: ${errorClientes.message}`);

  const idsDeCliente = (clientesDelDueno ?? [])
    .map((c) => c.id as string)
    .filter((id) => !clientId || id === clientId);

  // Sin clientes no hay movimientos que pedir, y un `in()` vacío en PostgREST
  // devuelve TODO en vez de nada -- que aquí sería el libro de otro negocio.
  const qMov = idsDeCliente.length
    ? supabase
        .from("movements")
        .select("type, amount, currency, created_at, client_id")
        .in("client_id", idsDeCliente)
        .is("deleted_at", null)
        .gte("created_at", desdeIso)
        .lte("created_at", hastaIso)
    : null;

  // `countUnregisteredOrders` Y NO UNA CONSULTA PROPIA: es la MISMA función
  // que alimenta la campana y el enlace de Pedidos. Si Reportes contara por su
  // cuenta, un día diría «5 por atender» con la campana en 4 y no habría forma
  // de saber cuál miente. Además cuenta por `status`, no por fechas, que es el
  // estado actual -- lo correcto aquí: un pedido sin atender lo está hoy,
  // caiga o no dentro de la ventana del informe.
  const [resVentas, resMov, resResumen, pedidos, dineroPorAtender] = await Promise.all([
    qVentas,
    qMov ?? Promise.resolve({ data: [], error: null }),
    qResumen,
    countUnregisteredOrders(supabase, ownerId),
    pendingOrdersMoney(supabase, ownerId),
  ]);

  // SE MIRA EL `error` DE CADA UNA, y no solo el `data`. Descartarlo es lo que
  // convirtió una columna inexistente en un cero creíble durante un día
  // entero. Un informe que no puede leer sus datos tiene que decirlo, no
  // dibujar ceros: `error.tsx` de la ruta enseña la pantalla de fallo.
  for (const [que, r] of [
    ["ventas", resVentas],
    ["movimientos", resMov],
    ["resúmenes", resResumen],
  ] as const) {
    if (r.error) throw new Error(`reportes: ${que}: ${r.error.message}`);
  }

  const ventas = resVentas.data;
  const movimientos = resMov.data;
  const resumenes = resResumen.data;

  const idsDeVenta = (ventas ?? []).map((v) => v.id as string);
  const deCatalogo = new Set(
    (ventas ?? []).filter((v) => v.catalog_order_id).map((v) => v.id as string),
  );
  const cuandoSeVendio = new Map(
    (ventas ?? []).map((v) => [v.id as string, v.created_at as string]),
  );

  // `in()` con una lista vacía devuelve todo en PostgREST, así que se corta
  // aquí: sin ventas no hay líneas ni pagos que pedir.
  const [{ data: lineas }, { data: pagos }, { data: cargosDeVenta }] = idsDeVenta.length
    ? await Promise.all([
        supabase.from("sale_lines").select("sale_id, quantity, unit_price, currency").in("sale_id", idsDeVenta),
        supabase.from("sale_payments").select("sale_id, amount, currency, created_at").in("sale_id", idsDeVenta),
        // ── QUÉ LIBRO DE QUÉ VENTA QUEDÓ FIADO ─────────────────────────
        //
        // SE PREGUNTA POR `sale_id` Y NO POR FECHA, aunque `movimientos` de
        // arriba ya traiga cargos: aquella consulta lleva el filtro del rango
        // y el de cliente, y aquí hace falta la respuesta EXACTA para cada
        // venta descargada. Un cargo que cayera fuera de esa ventana por un
        // segundo convertiría un fiado en una venta de contado.
        supabase
          .from("movements")
          .select("sale_id, currency, type")
          .in("sale_id", idsDeVenta)
          .is("deleted_at", null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  // LA MISMA CLAVE QUE EL HISTORIAL DEL CLIENTE, importada y no reescrita:
  // `claveDeFila` es lo que decide allí si una venta sale como «De contado» o
  // como «Fiado», y dos definiciones de «contado» en la misma app es cómo una
  // pantalla acaba contradiciendo a la otra.
  //
  // UN CARGO BORRADO NO CUENTA (`deleted_at is null`): si el tendero retira el
  // fiado de una venta mixta, ese libro pasa a ser lo que ahora es -- una
  // venta pagada. Se acepta a propósito; la alternativa sería que la cifra
  // dependiera de algo que ya no existe.
  const librosFiados = new Set(
    (cargosDeVenta ?? [])
      .filter((m) => m.type !== "payment")
      .map((m) => claveDeFila(m.sale_id as string, (m.currency as "USD" | "EUR" | null) ?? null)),
  );

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

  const abonosPorLibro: Partial<Record<Libro, number>> = {};
  const fiadosPorLibro: Partial<Record<Libro, number>> = {};
  for (const l of libros) {
    abonosPorLibro[l] = 0;
    fiadosPorLibro[l] = 0;
  }

  // ── «TRANSACCIONES POR CATÁLOGO» SIGUE SIENDO LO VENDIDO ────────────
  //
  // Es lo único que queda saliendo de `sale_lines`, y es deliberado:
  // *«debe calcular el total de monto transaccionado a través de los pedidos
  // registrados, incluyendo fiados y de contado»* (dueño, 2026-10-29).
  //
  // CONSECUENCIA QUE HAY QUE DECIR EN LA PANTALLA: esta cifra puede salir
  // MAYOR que «Ventas», porque aquella ya no cuenta los fiados. En dev son
  // $1.729,00 contra $1.556,00. Las dos son correctas y juntas se leen como un
  // error, así que el subtítulo de la tarjeta explica qué cuenta cada una.
  for (const li of lineas ?? []) {
    const libro = (li.currency as Libro) ?? "COP";
    if (!libros.includes(libro)) continue;
    if (!deCatalogo.has(li.sale_id as string)) continue;

    // ── LA HOLGURA NO CUENTA EN LOS TOTALES ──────────────────────────
    //
    // La consulta pide DOS DÍAS de más por cada punta, para que un movimiento
    // pegado al borde no se pierda al repartir los cubos. Sumar todo lo
    // descargado mete esos días en la cifra grande.
    //
    // MEDIDO EL 2026-10-27, y es la clase de fallo que no se ve: con el rango
    // puesto en 20-27 oct la pantalla decía $12.142,00 y la base decía
    // $11.959,00. Los 183 dólares de diferencia eran ventas de los días de
    // holgura. No hay error, no hay hueco: solo un informe que no contesta lo
    // que su propio filtro promete. Se cazó comparando contra la base, no
    // mirando la pantalla.
    const cuando = cuandoSeVendio.get(li.sale_id as string);
    if (!cuando || cuboDe(cs, cuando) < 0) continue;

    catalogoPorLibro[libro] =
      (catalogoPorLibro[libro] ?? 0) + Number(li.quantity) * Number(li.unit_price);
  }

  // ── «VENTAS» Y LA MITAD DE «ABONOS»: LOS PAGOS DE LA CAJA ───────────
  //
  // Cada pago va a un sitio u otro según si SU LIBRO quedó fiado. Los dos
  // montones son disjuntos por construcción, así que ningún pago se cuenta
  // dos veces ni se pierde.
  //
  // EL CUBO ES EL DE LA FECHA DE LA VENTA, no el del pago. Son el mismo
  // instante --estos pagos se escriben al registrar la venta-- y usar el de
  // la venta es lo que hace que la tarjeta y su gráfico sumen lo mismo aunque
  // algún día dejen de serlo.
  for (const pg of pagos ?? []) {
    const libro = (pg.currency as Libro) ?? "COP";
    if (!libros.includes(libro)) continue;
    const cuando = cuandoSeVendio.get(pg.sale_id as string);
    const i = cuando ? cuboDe(cs, cuando) : -1;
    if (i < 0) continue;

    const monto = Number(pg.amount);
    if (librosFiados.has(claveDeFila(pg.sale_id as string, libroDeVenta(pg.currency as string)))) {
      abonosPorLibro[libro] = (abonosPorLibro[libro] ?? 0) + monto;
      continue;
    }
    ventasPorLibro[libro] = (ventasPorLibro[libro] ?? 0) + monto;
    serieVentas[i][libro] = (serieVentas[i][libro] ?? 0) + monto;
  }

  // ── TRANSACCIONES: RECUENTOS, no importes. La razón, arriba. ───────
  const serieTransacciones: PuntoDeTransacciones[] = cs.map((c) => ({
    etiqueta: c.etiqueta,
    contado: 0,
    abono: 0,
    fiado: 0,
  }));

  // ── «DE CONTADO» CUENTA VENTAS, NO FILAS DE PAGO ───────────────────
  //
  // Decisión del dueño el 2026-10-29: *«debe ser todo lo vendido "De contado"
  // por cualquier flujo (ventas, pedidos, etc)»*.
  //
  // CONTABA `sale_payments` A PELO, y eso mentía por los dos lados:
  //
  //   · Una venta cobrada en DOS MONEDAS --o en efectivo y transferencia--
  //     son dos filas de pago, así que sumaba 2 por una sola venta.
  //   · Y el abono que el cliente paga AL FIAR también es una fila de pago,
  //     así que un fiado sumaba 1 a «De contado».
  //
  // AHORA CUENTA PARES (VENTA, LIBRO) SIN CARGO, que es exactamente lo que
  // esta app llama «De contado» desde la decisión del dueño del 2026-10-20, y
  // lo mismo que ya suma la tarjeta «Ventas». Una pantalla no puede tener dos
  // definiciones de contado.
  //
  // UNA VENTA MIXTA SUMA 1 AQUÍ Y 1 EN «FIADO», y es lo correcto: en el
  // historial del cliente esa compra sale como DOS tarjetas independientes.
  //
  // «POR CUALQUIER FLUJO» YA ESTABA CUBIERTO: un pedido del catálogo se
  // registra creando una venta normal --con su `catalog_order_id`-- así que
  // entra por `sales` como cualquier otra. No hay un segundo sitio donde
  // mirar.
  const contadoYaContado = new Set<string>();
  for (const pg of pagos ?? []) {
    const clave = claveDeFila(pg.sale_id as string, libroDeVenta(pg.currency as string));
    if (librosFiados.has(clave) || contadoYaContado.has(clave)) continue;
    const cuando = cuandoSeVendio.get(pg.sale_id as string);
    const i = cuando ? cuboDe(cs, cuando) : -1;
    if (i < 0) continue;
    contadoYaContado.add(clave);
    serieTransacciones[i].contado += 1;
  }
  for (const m of movimientos ?? []) {
    const libro = libroDeMovimiento(m.currency as string | null);
    if (!libros.includes(libro)) continue;
    const i = cuboDe(cs, m.created_at as string);
    if (i < 0) continue;
    // EL RECUENTO Y EL DINERO EN LA MISMA PASADA. Un segundo bucle sobre las
    // mismas filas es un segundo sitio desde el que la barra del gráfico y la
    // cifra de la tarjeta pueden separarse.
    const monto = Number(m.amount);
    if (m.type === "payment") {
      serieTransacciones[i].abono += 1;
      abonosPorLibro[libro] = (abonosPorLibro[libro] ?? 0) + monto;
    } else {
      serieTransacciones[i].fiado += 1;
      fiadosPorLibro[libro] = (fiadosPorLibro[libro] ?? 0) + monto;
    }
  }

  // ── PLAZOS DE PAGO ─────────────────────────────────────────────────
  //
  // El mismo `estadoDeCliente` que pinta el chip de la lista de clientes. Si
  // esta pantalla contara con un criterio propio, «11 con plazo vencido» aquí
  // y una lista con otros once allí serían dos verdades que no se pueden
  // reconciliar mirando.
  const plazos = { porVencer: 0, vencido: 0, criticos: 0, malasPagas: 0, sinPlazo: 0 };
  const clientesPorPlazo: Record<ClavePlazo, ClienteDePlazo[]> = {
    porVencer: [],
    vencido: [],
    criticos: [],
    malasPagas: [],
    sinPlazo: [],
  };

  for (const r of (resumenes ?? []) as ClientSummary[]) {
    const { status, currency } = estadoDeCliente({
      fila: r,
      saldos: {
        cop: Number(r.balance ?? 0),
        usd: Number(r.balance_usd ?? 0),
        eur: Number(r.balance_eur ?? 0),
      },
      saldoCombinado: Number(r.balance ?? 0),
      dosLibros,
    });

    // EL LIBRO QUE MANDA ES EL QUE DECIDIÓ EL ESTADO, no el mayor ni la suma:
    // si el chip dice «Plazo vencido» por los euros, la cifra de al lado tiene
    // que ser la de euros. Es la misma regla que la lista de clientes ya
    // sigue -- el estado y su importe hablan del mismo libro o no hablan de
    // nada.
    const libro: Libro = currency ?? (dosLibros ? "USD" : "COP");
    const monto =
      libro === "USD"
        ? Number(r.balance_usd ?? 0)
        : libro === "EUR"
          ? Number(r.balance_eur ?? 0)
          : Number(r.balance ?? 0);

    const venceEl =
      (libro === "USD"
        ? r.worst_unpaid_charge_due_at_usd
        : libro === "EUR"
          ? r.worst_unpaid_charge_due_at_eur
          : r.worst_unpaid_charge_due_at_cop) ??
      r.worst_unpaid_charge_due_at ??
      null;

    const fila: ClienteDePlazo = {
      clientId: r.client_id,
      nombre: r.name,
      monto: Math.abs(monto),
      libro,
      status,
      marcado: Boolean(r.is_flagged),
      venceEl,
    };

    // MALA PAGA ES UNA MARCA, NO UN ESTADO, así que un cliente puede salir en
    // su hoja Y en la del plazo que le toque. No es una fila duplicada: son
    // dos preguntas distintas --«a quién hay que cobrar» y «de quién me
    // fío»-- y la lista de Clientes ya las trata así.
    if (r.is_flagged) {
      plazos.malasPagas += 1;
      clientesPorPlazo.malasPagas.push(fila);
    }

    if (status === "dentro_del_plazo") {
      plazos.porVencer += 1;
      clientesPorPlazo.porVencer.push(fila);
    } else if (status === "plazo_vencido") {
      plazos.vencido += 1;
      clientesPorPlazo.vencido.push(fila);
    } else if (status === "critico") {
      plazos.criticos += 1;
      clientesPorPlazo.criticos.push(fila);
    } else if (status === "sin_plazo") {
      plazos.sinPlazo += 1;
      clientesPorPlazo.sinPlazo.push(fila);
    }
  }

  // DE MÁS GRAVE A MENOS DENTRO DE CADA HOJA: el que lleva más tiempo vencido
  // primero. Sin orden, la hoja devuelve el orden de la consulta -- que es el
  // de la vista y no significa nada para quien va a cobrar.
  for (const k of Object.keys(clientesPorPlazo) as ClavePlazo[]) {
    clientesPorPlazo[k].sort((a, b) => {
      if (a.venceEl && b.venceEl) return a.venceEl.localeCompare(b.venceEl);
      if (a.venceEl) return -1;
      if (b.venceEl) return 1;
      return b.monto - a.monto;
    });
  }

  // ── MEJORES PAGADORES: POR PUNTAJE DE CRÉDITO ──────────────────────
  //
  // Decisión del dueño el 2026-10-29: *«debería rankear por lo que tienen
  // mejor score crediticio "Puntaje de crédito"»*.
  //
  // ───────────────────────────────────────────────────────────────────
  // QUÉ SUSTITUYE, Y POR QUÉ ESTABA MAL
  //
  // Ordenaba por «lo que ha pagado en la ventana» -- y ni siquiera eso: se
  // quedaba con el ABONO MÁS GRANDE de cada cliente, no con la suma. Medido
  // en dev el 2026-10-28: un cliente con un solo abono de €50 entraba por
  // delante de otro con $81 repartidos en cinco. El subtítulo decía «quien
  // más abonó» y la lista decía otra cosa.
  //
  // ───────────────────────────────────────────────────────────────────
  // NO DEPENDE DEL PERIODO, Y ESO ES PARTE DE LA DECISIÓN
  //
  // El puntaje mide TODA la historia del cliente: su puntualidad, su
  // antigüedad y los ciclos que ha cerrado. Recortarlo al rango elegido sería
  // otra cosa --y con «Hoy» puesto la lista saldría vacía casi siempre--. Así
  // que esta tarjeta deja de moverse con el selector de fechas, igual que
  // «Por cobrar», y el subtítulo de la pantalla lo dice.
  //
  // LOS «SIN HISTORIAL» QUEDAN FUERA. Un cliente sin cargos cerrados no es un
  // buen pagador: es un desconocido. Dejarlo entrar pondría arriba a quien
  // nunca ha debido nada por delante de quien lleva dos años pagando a
  // tiempo.
  //
  // ES EL MISMO `computeCreditScoresForClients` QUE CARTERA, importado y no
  // reescrito. Dos cuentas del mismo puntaje se separan, y esta app ya pagó
  // esa lección con `CT-124`: la base respetaba el fiado que el tendero
  // elegía y el puntaje pagaba el más viejo.
  //
  // LO QUE CUESTA: esa función lee los movimientos de TODOS los clientes del
  // dueño sin filtro de fecha, porque un puntaje de por vida no se puede
  // calcular con una ventana. Con los 468 movimientos que producción tiene
  // entre todos no se nota; el día que un solo negocio tenga decenas de
  // miles, esto es lo primero que hay que paginar.
  const puntajes = await computeCreditScoresForClients(
    supabase,
    (resumenes ?? []) as ClientSummary[],
    effectiveRate,
  );

  const mejoresPagadores: MejorPagador[] = ((resumenes ?? []) as ClientSummary[])
    .map((r) => ({ r, p: puntajes[r.client_id] }))
    .filter(({ p }) => p != null && p.tier !== "Sin historial")
    .map(({ r, p }) => ({
      clientId: r.client_id,
      nombre: r.name,
      puntaje: p.score,
      nivel: p.tier,
    }))
    // A IGUALDAD DE PUNTAJE manda el nombre, y no el orden de la consulta:
    // dos empatados saldrían en un orden distinto en cada carga.
    .sort((a, b) => b.puntaje - a.puntaje || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, 5);

  return {
    libros,
    porCobrar,
    ventas: ventasPorLibro,
    abonos: abonosPorLibro,
    fiados: fiadosPorLibro,
    ventasPorCatalogo: catalogoPorLibro,
    serieVentas,
    serieTransacciones,
    pedidosPorAtender: pedidos,
    dineroPorAtender,
    plazos,
    clientesPorPlazo,
    mejoresPagadores,
    // SIN EL FILTRO DE CLIENTE, a propósito: `idsDeCliente` ya viene recortado
    // a uno cuando hay `?cliente=` puesto, y usarlo aquí diría «negocio
    // vacío» de un negocio entero por el filtro de una pantalla.
    negocioSinNada: (clientesDelDueno ?? []).length === 0,
  };
}
