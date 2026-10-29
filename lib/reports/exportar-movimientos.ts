import type { createClient } from "@/lib/supabase/server";
import type { OwnerCountry } from "@/lib/types";
import { documento, fila, importe } from "@/lib/reports/csv";
import { ventanaDelNegocio } from "@/lib/reports/zona-del-negocio";

// ═══════════════════════════════════════════════════════════════════════
// EL FICHERO DE MOVIMIENTOS — fiados y abonos del libro, en CSV
//
// Encargo del dueño el 2026-10-27, con el frame `1667:19722` del menú:
// *«al seleccionar qué descargar, la descarga se realiza con filtros
// aplicados»*.
//
// LO QUE ESTA FASE **NO** HACE, y el dueño lo decidió así: ni `.xlsx` ni
// `.pdf` ni envío por correo. Las tres piden dependencia nueva y
// `new-api-risk-review` antes de instalar nada.
//
// ───────────────────────────────────────────────────────────────────────
// NO COMPARTE CÓDIGO CON `cargarFacturacion`, Y NO ES PEREZA
//
// Tres razones, y ninguna es de estilo:
//
// 1. **Calcula otro número.** `porCobrar` hace `Math.max(0, balance)` por
//    cliente: son cuentas por COBRAR, y un cliente con saldo a favor no resta.
//    El `saldo` de un fichero es el NETO del libro, donde sí resta. Misma
//    palabra, dos cifras -- compartir la función dejaría una de las dos mal.
// 2. **La pantalla lee una ventana 2 días más ancha** que el rango, a
//    propósito, y vuelve a filtrar en JS. Un fichero tiene que consultar el
//    límite exacto o la comprobación del número de filas compara contra otra
//    ventana.
// 3. **La pantalla no pagina ni comprueba su total**, por su propia nota.
//    Meterle las dos cosas sería cambiar el informe de pantalla en el mismo
//    cambio que entrega el fichero.
//
// ───────────────────────────────────────────────────────────────────────
// LA PROPIEDAD SE COMPRUEBA EN CÓDIGO, Y NO CON `owner_id`
//
// **`movements` NO TIENE `owner_id`**: se llega por `clients.owner_id`
// (`supabase/schema.sql:131`). Así que el filtro explícito que `CLAUDE.md`
// exige es el embed `clients!inner(owner_id)` + `.eq("clients.owner_id", …)`,
// que es el patrón que `lib/moneda-habitual.ts` ya usa.
//
// Y eso trae una ventaja que no es accesoria: **el nombre que sale en una fila
// viene del mismo embed que comprueba su dueño**, así que no puede desviarse.
// La alternativa --consultar los clientes aparte y cruzarlos-- son dos
// verdades que pueden separarse, además de una URL con mil ids dentro.
// ═══════════════════════════════════════════════════════════════════════

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Los códigos de fallo. La ruta y la pantalla leen la misma tabla. */
// ═══════════════════════════════════════════════════════════════════════
// LAS CIFRAS DEL FICHERO, UNA POR UNA — para auditarlo sin leerlo entero
//
// Encargo del dueño el 2026-10-29, cerrando el hueco que la auditoría dejó:
// las tres pantallas tenían su tabla y el FICHERO no, aunque es el que se
// abre en Excel y se discute con cifras delante.
//
//   Las filas de movimiento
//     Una por `movements` del rango, del dueño, sin borrar. Van tal cual
//     salen de la base: fecha, cliente, tipo, importe, moneda, descripción.
//     NO se recalcula nada -- el fichero es una copia, no un informe.
//
//   Saldo inicial (una fila por moneda, antes de las demás)
//     El `running_balance` de la ÚLTIMA fila viva de esa moneda ANTES del
//     rango. Si no hubo ninguna, la fila lo dice --«sin movimientos
//     anteriores»-- en vez de escribir un cero que parecería un saldo.
//
//     POR QUÉ ES OBLIGATORIO, y no cosmético: `running_balance` es
//     acumulativo desde el principio de los tiempos. Exportar «solo marzo»
//     sin esta fila da un fichero que arranca en $70.000 sin decir de dónde
//     sale, y quien lo sume de arriba abajo obtiene otra cosa. Lo fija
//     `REPORTES-PLAN.md` como condición dura.
//
//   Saldo final (una fila por moneda, al terminar)
//     El `running_balance` de la última fila viva de esa moneda DENTRO del
//     rango; si no hubo ninguna, el saldo inicial sigue vigente y la fila lo
//     dice. Cuadra con el saldo que la app enseña en la ficha del cliente,
//     porque sale de la misma columna.
//
//   El recuento, y su parada dura
//     El fichero escribe cuántas filas trae Y contra qué conteo se comprobó.
//     El paginador pide el total a la base ANTES y DESPUÉS de leer: si los
//     dos no coinciden --alguien registró algo a mitad-- o si lo paginado no
//     llega a ese total, NO SE ENTREGA NADA. PostgREST corta en 1.000 filas
//     en silencio, y medio fichero que parece entero es peor que ninguno.
//
//   El rango impreso en la cabecera
//     Resuelto en la zona del NEGOCIO (`zona-del-negocio.ts`), no en la de
//     quien ejecuta. Va escrito en el fichero para que una cifra discutida se
//     pueda comprobar en vez de discutirse.
//
//     ⚠️ LA PANTALLA NO USA ESA ZONA: `rango.ts` resuelve en la del proceso
//     que lo ejecuta, que en el servidor puede ser UTC. Así que el fichero y
//     la pantalla pueden cubrir ventanas distintas de hasta cinco horas en
//     cada punta. Está abierto.
// ═══════════════════════════════════════════════════════════════════════

export type MotivoDeFallo =
  | "rango"
  | "lectura"
  | "incompleto"
  | "cambio_al_vuelo"
  | "moneda_desconocida"
  // Los dos que no salen de aquí sino de la ruta: el país no se pudo leer y
  // el `?cliente=` no es de este dueño. Viven en la misma tabla a propósito,
  // porque el sitio donde se redacta un mensaje tiene que ser uno solo.
  | "pais"
  | "cliente";

// EL MENSAJE QUE VE EL TENDERO, en un solo sitio, para que la ruta y la
// pantalla no puedan decir cosas distintas del mismo fallo.
//
// NADA DE POSTGRES LLEGA AQUÍ. El detalle real va a `console.error`, que es la
// regla de `CLAUDE.md` sobre no filtrar error crudo -- y aunque esta ruta SÍ
// pide sesión, un texto de PostgREST tampoco le dice nada útil a un tendero.
export const MENSAJE_DE_FALLO: Record<MotivoDeFallo, string> = {
  rango: "Elige las dos fechas antes de descargar.",
  lectura: "No pudimos leer tus movimientos en este momento. Inténtalo otra vez.",
  incompleto:
    "La descarga salió incompleta y no te la vamos a entregar así. Inténtalo otra vez.",
  cambio_al_vuelo:
    "Se registró un movimiento mientras preparábamos el archivo. Vuelve a descargarlo.",
  moneda_desconocida:
    "Encontramos un movimiento en una moneda que tu negocio no maneja. Escríbenos.",
  pais: "No pudimos confirmar el país de tu negocio. Vuelve a intentarlo.",
  cliente: "Ese cliente no es de tu negocio.",
};

/** El mensaje de un `?motivo=` que llega en la URL, que puede ser cualquier cosa. */
export function mensajeDelMotivo(motivo: string | null | undefined): string {
  if (motivo && motivo in MENSAJE_DE_FALLO) {
    return MENSAJE_DE_FALLO[motivo as MotivoDeFallo];
  }
  // UN CÓDIGO DESCONOCIDO NO DEJA LA PANTALLA MUDA. El parámetro llega en una
  // URL que se puede teclear, y «no pasó nada» sería peor que un mensaje
  // genérico: el tendero sabe que le dio a descargar y no recibió nada.
  return "No pudimos preparar tu descarga. Inténtalo otra vez.";
}

type Libro = "USD" | "EUR" | "COP";

/** `movements.currency` guarda el libro colombiano como `null`. */
function libroDe(currency: string | null): Libro {
  return (currency as Libro | null) ?? "COP";
}

const LIBROS_DEL_PAIS: Record<OwnerCountry, Libro[]> = {
  // LOS DOS SIEMPRE, aunque uno no tenga ni un movimiento: un bloque EUR
  // ausente se lee como «no se exportó», no como «no hubo nada en euros».
  VE: ["USD", "EUR"],
  CO: ["COP"],
};

type FilaCruda = {
  id: string;
  transaction_code: string | null;
  created_at: string;
  type: string;
  amount: number;
  currency: string | null;
  description: string | null;
  running_balance: number | null;
  clients: { name: string; document_id: string | null; trashed_at: string | null } | null;
};

/** Lo que `conFiltros` necesita de un constructor de consultas, y nada mas. */
type Filtrable = {
  eq: (c: string, v: string) => Filtrable;
  is: (c: string, v: null) => Filtrable;
  gte: (c: string, v: string) => Filtrable;
  lt: (c: string, v: string) => Filtrable;
};

const PAGINA = 1000;

/**
 * Lee TODAS las filas que casan con los filtros, pasando por encima del tope
 * de 1.000 de PostgREST.
 *
 * **EL `.order()` ES IMPRESCINDIBLE AQUÍ Y `rpcAll` NO LO NECESITA.** Aquel
 * pagina una función cuyo SQL ya trae su propio `order by`; una lectura de
 * tabla pelada no tiene orden definido, y entonces el `offset` de `.range()`
 * puede repetir o saltarse filas entre páginas. Sin el orden por dos claves
 * --`created_at` y luego `id` para los empates, el mismo desempate que usa el
 * disparador `set_movement_running_balance`-- el número de filas puede salir
 * correcto con el contenido equivocado, que es el único fallo que la
 * comprobación de más abajo NO puede cazar.
 */
async function leerTodo(
  hacerConsulta: () => ReturnType<ReturnType<SupabaseServerClient["from"]>["select"]>,
): Promise<FilaCruda[]> {
  const filas: FilaCruda[] = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await hacerConsulta()
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    // SE LANZA, no se devuelve `[]`. Es justo el fallo que `facturacion.ts`
    // tuvo hoy: el error descartado dibujaba ceros creíbles.
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as unknown as FilaCruda[];
    filas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return filas;
}

export type Exportacion = { csv: string; nombre: string; filas: number };

export async function exportarMovimientos({
  supabase,
  ownerId,
  country,
  nombreDelNegocio,
  desde,
  hasta,
  clientId = null,
}: {
  supabase: SupabaseServerClient;
  ownerId: string;
  country: OwnerCountry;
  nombreDelNegocio: string;
  /** `YYYY-MM-DD`. Obligatorio: aquí no se adivina un rango. */
  desde: string | null;
  hasta: string | null;
  clientId?: string | null;
}): Promise<Exportacion | { motivo: MotivoDeFallo }> {
  const ventana = ventanaDelNegocio(desde, hasta, country);
  if (!ventana) return { motivo: "rango" };

  // ── LOS FILTROS, UNA SOLA VEZ ────────────────────────────────────────
  //
  // Se construyen con una función y no copiándolos, porque los usan CUATRO
  // consultas --las dos ventanas y los dos conteos-- y un filtro que se
  // copia tres veces es un filtro que se separa en la cuarta. Si el conteo
  // no lleva exactamente los mismos filtros que la lectura, la comprobación
  // de abajo compara dos preguntas distintas y falla sin motivo.
  // EL GENÉRICO DEVUELVE EL MISMO TIPO QUE ENTRA, así que quien la llama
  // conserva su constructor de consulta entero --`.order()`, `.range()`, el
  // tipo del resultado-- y la conversión se queda ENCERRADA en este cuerpo.
  // Hace falta porque `.eq("clients.owner_id", …)` navega una relación y el
  // tipo de columnas de PostgREST solo conoce las de la tabla.
  const conFiltros = <Q>(q: Q, enRango: boolean): Q => {
    const b = q as unknown as Filtrable;
    let r = b.eq("clients.owner_id", ownerId).is("deleted_at", null);
    if (clientId) r = r.eq("client_id", clientId);
    r = enRango
      ? r.gte("created_at", ventana.desdeUtc).lt("created_at", ventana.hastaExclusivoUtc)
      : r.lt("created_at", ventana.desdeUtc);
    return r as unknown as Q;
  };

  const COLUMNAS_EN_RANGO =
    "id, transaction_code, created_at, type, amount, currency, description, running_balance, clients!inner(name, document_id, trashed_at, owner_id)";
  // La ventana ANTERIOR solo necesita tres columnas: con el historial entero
  // de un negocio detrás, pedir la descripción de cada fila es tráfico por
  // nada. Ver el techo declarado al final de este archivo.
  const COLUMNAS_ANTES = "type, amount, currency, clients!inner(owner_id)";

  const contar = async (enRango: boolean): Promise<number> => {
    const { count, error } = await conFiltros(
      // `head: true` no trae ni una fila: el conteo lo hace Postgres sobre la
      // tabla, así que es INDEPENDIENTE de lo que el paginador devolvió. Eso
      // es lo que lo convierte en una comprobación y no en un eco.
      supabase.from("movements").select("id, clients!inner(owner_id)", {
        count: "exact",
        head: true,
      }),
      enRango,
    );
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  let filasAntes: FilaCruda[];
  let filasEnRango: FilaCruda[];
  let totalAntes: number;
  let totalDespues: number;
  try {
    // EL CONTEO VA ANTES Y DESPUÉS, y son dos preguntas distintas -- ver la
    // tabla de más abajo.
    totalAntes = await contar(true);
    [filasAntes, filasEnRango] = await Promise.all([
      leerTodo(() => conFiltros(supabase.from("movements").select(COLUMNAS_ANTES), false)),
      leerTodo(() =>
        conFiltros(supabase.from("movements").select(COLUMNAS_EN_RANGO), true),
      ),
    ]);
    totalDespues = await contar(true);
  } catch (e) {
    console.error("[exportar-movimientos] lectura", e);
    return { motivo: "lectura" };
  }

  // ── LA PARADA DURA ───────────────────────────────────────────────────
  //
  // Dos conteos y no uno, porque hay DOS fallos que se confunden con uno:
  //
  //   antes === después === filas   -> completo, se escribe
  //   antes !== después             -> alguien registró un movimiento desde
  //                                    otro teléfono mientras esto corría.
  //                                    Inofensivo, se repite y sale bien.
  //   antes === después !== filas   -> **el corte de 1.000 filas**. Es el
  //                                    fallo mudo que el plan marca como
  //                                    innegociable.
  //
  // Con un solo conteo los dos se mezclan: o se bloquea al tendero por algo
  // inofensivo, o se tapa el que sí importa.
  if (totalAntes !== totalDespues) {
    console.error(
      `[exportar-movimientos] el conteo cambió durante la lectura: ${totalAntes} -> ${totalDespues}`,
    );
    return { motivo: "cambio_al_vuelo" };
  }
  if (filasEnRango.length !== totalAntes) {
    console.error(
      `[exportar-movimientos] filas incompletas: la base cuenta ${totalAntes} y el paginador trajo ${filasEnRango.length}`,
    );
    return { motivo: "incompleto" };
  }

  // ── LOS SALDOS DE APERTURA, POR LIBRO ────────────────────────────────
  //
  // QUÉ ES: la suma, sobre todos los clientes de este dueño, de lo que cada
  // uno debía en ese libro el instante antes de que empiece el rango.
  //
  // CÓMO SE CALCULA, y por qué no se lee `running_balance`: se suman los
  // importes con signo de la ventana anterior. Es IDÉNTICO por construcción
  // --cada cadena de `running_balance` arranca en cero, así que esa columna
  // ES esta suma acumulada-- y además sobrevive al fallo que la columna no
  // sobrevive: un borrado cuyo `recalc_client_running_balance` no corrió
  // deja el `running_balance` viejo, y la suma con signo sigue bien.
  //
  // SIN `Math.max(0, …)`. Un cliente con saldo a favor RESTA. Esta cifra es
  // el neto del libro y va a diferir de la tarjeta «Por cobrar» de la
  // pantalla, que descarta los saldos a favor cliente por cliente. La
  // cabecera del fichero lo dice con palabras, porque esa diferencia es
  // exactamente la forma que tiene una discusión.
  const libros = LIBROS_DEL_PAIS[country];
  const apertura: Record<string, number> = {};
  const huboAntes: Record<string, boolean> = {};
  for (const l of libros) {
    apertura[l] = 0;
    huboAntes[l] = false;
  }

  const sumar = (f: FilaCruda, destino: Record<string, number>): MotivoDeFallo | null => {
    const l = libroDe(f.currency);
    if (!(l in destino)) {
      // UNA FILA EN UNA MONEDA QUE EL NEGOCIO NO LLEVA ES CORRUPCIÓN, no un
      // caso de pantalla: la restricción de la tabla permite `null` para
      // cualquier dueño, así que un negocio venezolano con una fila sin
      // moneda es un dato roto. Se para en vez de enseñarlo en un bloque
      // inventado.
      console.error(`[exportar-movimientos] libro inesperado ${l} para un negocio ${country}`);
      return "moneda_desconocida";
    }
    destino[l] += f.type === "charge" ? Number(f.amount) : -Number(f.amount);
    return null;
  };

  for (const f of filasAntes) {
    const mal = sumar(f, apertura);
    if (mal) return { motivo: mal };
    huboAntes[libroDe(f.currency)] = true;
  }

  // ── EL FICHERO ───────────────────────────────────────────────────────
  const fecha = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: ventana.zona,
  });
  const hora = new Intl.DateTimeFormat("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ventana.zona,
  });

  const lineas: string[] = [
    fila(["Sevenz — Movimientos del negocio"]),
    fila(["Negocio", nombreDelNegocio]),
    fila(["Rango", `del ${desde} al ${hasta} (los dos días incluidos)`]),
    fila(["Zona del negocio", `${ventana.zona} (UTC${ventana.desplazamiento}) · país ${country}`]),
    // EL RANGO RESUELTO, EN UTC, IMPRESO. Es lo que convierte una cifra
    // discutida en una cifra comprobable: sin esto, «¿por qué falta la venta
    // del lunes?» no se puede contestar sin reconstruir la pantalla.
    fila([
      "Rango resuelto (UTC)",
      `desde ${ventana.desdeUtc} hasta ${ventana.hastaExclusivoUtc} (fin excluido)`,
    ]),
    fila(["Generado", `${fecha.format(new Date())} ${hora.format(new Date())} hora del negocio`]),
    // QUÉ NO ESTÁ AQUÍ, dicho por delante: una venta de contado NO escribe
    // movimiento --`supabase/124_la_venta.sql`, a propósito-- así que este
    // fichero no la trae. Sin esta línea, el tendero suma sus fiados y
    // concluye que le faltan ventas.
    fila(["Contenido", "Fiados y abonos del libro. NO incluye las ventas de contado."]),
    fila([
      "Saldos",
      "Neto del libro: los saldos a favor restan. No es la misma cifra que «Por cobrar» de la pantalla.",
    ]),
    fila([
      "Movimientos exportados",
      `${filasEnRango.length} (comprobado contra el conteo de la base: ${totalAntes})`,
    ]),
  ];
  if (clientId) {
    const nombre = filasEnRango[0]?.clients?.name ?? "(sin movimientos en el rango)";
    lineas.push(fila(["Filtrado por cliente", nombre]));
  }

  const CABECERA = [
    "codigo",
    "fecha",
    "hora",
    "cliente",
    "documento",
    "tipo",
    "moneda",
    "fiado",
    "abono",
    "saldo_del_cliente",
    "saldo_del_libro",
    "descripcion",
    "nota",
    "id",
  ];

  // UN BLOQUE POR LIBRO, y no las dos monedas entremezcladas bajo un solo par
  // de saldos: eso daría una cifra que esta app nunca ha calculado -- dólares
  // y euros son deudas independientes y nunca se han sumado.
  for (const libro of libros) {
    lineas.push("");
    lineas.push(fila(["Libro", libro]));
    lineas.push(fila(CABECERA));

    let corriente = apertura[libro];
    lineas.push(
      fila([
        null,
        desde,
        "00:00",
        null,
        null,
        null,
        libro,
        null,
        null,
        null,
        importe(corriente),
        null,
        // «CERO PORQUE NO PASÓ NADA» Y «CERO PORQUE NADIE MIRÓ» NO SE LEEN
        // IGUAL, así que la fila sale siempre y la nota dice cuál es.
        huboAntes[libro] ? "saldo inicial" : "saldo inicial · sin movimientos anteriores",
        null,
      ]),
    );

    const delLibro = filasEnRango.filter((f) => libroDe(f.currency) === libro);
    for (const f of delLibro) {
      const esFiado = f.type === "charge";
      corriente += esFiado ? Number(f.amount) : -Number(f.amount);
      lineas.push(
        fila([
          f.transaction_code,
          fecha.format(new Date(f.created_at)),
          hora.format(new Date(f.created_at)),
          f.clients?.name ?? "",
          f.clients?.document_id ?? "",
          // `Fiado` / `Abono` Y NO `charge` / `payment`: el fichero lo abre un
          // tendero, y esas dos palabras no son su vocabulario.
          esFiado ? "Fiado" : "Abono",
          libro,
          esFiado ? importe(Number(f.amount)) : null,
          esFiado ? null : importe(Number(f.amount)),
          // DOS COLUMNAS DE DINERO Y NO UNA CON SIGNO: es la forma de la
          // libreta de papel, y la autosuma de Excel sobre `fiado` contesta
          // «cuánto fié» sin escribir una fórmula.
          f.running_balance == null ? null : importe(Number(f.running_balance)),
          // ESTE SALDO LO RECALCULA EL FICHERO, no la base: así la fila de
          // apertura, las de en medio y la de cierre cuadran entre sí y el
          // fichero es comprobable por dentro.
          importe(corriente),
          f.description ?? "",
          f.clients?.trashed_at ? "cliente en la papelera" : null,
          f.id,
        ]),
      );
    }

    lineas.push(
      fila([
        null,
        hasta,
        "23:59",
        null,
        null,
        null,
        libro,
        null,
        null,
        null,
        importe(corriente),
        null,
        delLibro.length ? "saldo final" : "saldo final · sin movimientos en el rango",
        null,
      ]),
    );
  }

  // CERO MOVIMIENTOS NO ES UN FALLO. Sale un fichero válido con sus dos filas
  // de saldo por libro: el tendero necesita poder DEMOSTRAR que esa semana no
  // pasó nada, y eso es algo que la gente necesita demostrar.
  return {
    csv: documento(lineas),
    nombre: `movimientos-${desde}-a-${hasta}.csv`,
    filas: filasEnRango.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EL TECHO, DICHO EN VOZ ALTA PARA QUE NADIE LO INFLE NI LO IGNORE
//
// Las dos ventanas se leen ENTERAS, así que la anterior al rango crece con el
// historial completo del negocio. Hoy eso no es nada: producción tenía 468
// movimientos ENTRE TODOS los negocios en septiembre, y
// `lib/weekly-lending-read.ts` mide 411 ms leyendo un negocio de 10.560.
//
// LA PAGINACIÓN NO ESTÁ PORQUE HAGA FALTA HOY. Está porque el fallo que evita
// es MUDO: PostgREST corta en 1.000 y no dice nada. Lo que sí es de hoy es la
// comprobación del total, que es lo que convierte un fichero corto en un error
// visible en vez de en un fichero que parece completo.
//
// CUÁNDO DEJA DE VALER, y cuál es el arreglo entonces: por encima de ~100.000
// movimientos en un negocio, la respuesta entera en memoria y el barrido de la
// ventana anterior se vuelven caros. El arreglo es una función `security
// definer` que agregue el saldo de apertura en SQL y una respuesta en flujo —
// no una reescritura. Mientras tanto el tope de 400 días de
// `ventanaDelNegocio` acota el otro lado.
//
// Y POR QUÉ NO VA EN FLUJO YA: un flujo compromete el `200` y parte del cuerpo
// ANTES de que la comprobación de arriba pueda correr. Todo el sentido de esa
// parada es que un fichero incompleto no llegue a existir.
// ═══════════════════════════════════════════════════════════════════════
