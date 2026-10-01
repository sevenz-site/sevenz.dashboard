// CASOS BORDE DE "SUBIR LIBRETA" — todo lo construido desde el último
// lanzamiento a producción (`95fa684`).
//
// ─────────────────────────────────────────────────────────────────────────
// QUÉ CUBRE, Y POR QUÉ HACÍA FALTA OTRA SUITE
//
// Ya había dos, y ninguna llegaba aquí:
//
//   `qa:import`     prueba la función SQL: atomicidad, documentos repetidos,
//                   el orden de los saldos, la fecha. Contra la base.
//   `qa:reconcile`  prueba `lib/reconcile.ts`: el saldo de la página, la base
//                   deducida, los libros por moneda.
//
// Lo que quedaba sin una sola prueba era la lógica que vivía DENTRO de los
// componentes — y es la que decide qué se sube y por cuánto:
//
//   * la fecha que la IA leyó, que desde la 076 acaba en `created_at` y por
//     tanto manda en el saldo corrido y en la mora;
//   * la línea de ajuste, que inventa un movimiento en la deuda de alguien;
//   * qué estado tiene cada tarjeta, que es lo que IMPIDE subir;
//   * quitar y recuperar movimientos y clientes.
//
// Para poder probarlas se sacaron a `lib/` el 2026-09-30: dentro de un archivo
// `"use client"` con JSX no se pueden importar desde Node. Los componentes las
// consumen desde ahí, así que no hay dos copias.
//
// NO TOCA LA BASE DE DATOS y no necesita `.env.local`: es todo lógica pura.
// Por eso corre en un segundo y se puede correr antes de cada commit.
import { diaLeido, valorDeInputFecha, isoDeLaFecha } from "../lib/fecha-de-libreta.ts";
import {
  construirAjuste,
  quitarMovimiento,
  recuperarMovimiento,
  quitarCliente,
  recuperarCliente,
  DESCRIPCION_DEL_AJUSTE,
} from "../lib/ajuste-de-libreta.ts";
import { conEstado } from "../lib/estado-de-tarjeta.ts";
import { guardarRevision, cargarRevision, olvidarRevision } from "../lib/revision-guardada.ts";
import { reconcileMovements, agruparPorCliente } from "../lib/reconcile.ts";
import { ErrorParaElDueno, mensajeDeError } from "../lib/errores-legibles.ts";
import { normalizeDocumentId } from "../lib/format.ts";
import {
  esLineaSuelta,
  esLineaSinMonto,
  separarLineasSueltas,
  nombresParaAsignar,
  asignarLineaSuelta,
  asignarTodasLasSueltas,
  pendientesDeResolver,
  motivoDeLineasPendientes,
} from "../lib/lineas-sueltas.ts";

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS " : "FALLO"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

let n = 0;
const mov = (p = {}) => ({
  client_name: "Ana",
  date: null,
  type: "charge",
  amount: 10,
  description: null,
  read_balance: null,
  confidence: "high",
  document_id: null,
  whatsapp: null,
  uid: `u${++n}`,
  currency: "USD",
  ...p,
});

// ═════════════════════════════════════════════════════════════════════════
// 1. LA FECHA DE LA LIBRETA
//
// Es el dato con más superficie de error de todo el flujo: lo lee una IA de
// algo escrito a mano, y de él dependen el saldo y la mora.
console.log("\n── La fecha que la IA leyó ──────────────────────────────────");

const dia = (s) =>
  diaLeido(s)?.toLocaleDateString("es-VE", { day: "numeric", month: "numeric", year: "numeric" }) ??
  null;

check("ISO normal", dia("2026-08-30") === "30/8/2026", dia("2026-08-30"));
check("ISO sin ceros a la izquierda", dia("2026-8-3") === "3/8/2026", dia("2026-8-3"));
// El prompt pide ISO, pero un modelo puede desobedecer y una libreta venezolana
// se escribe así. Sin el respaldo, `new Date()` lo lee a la americana o da NaN
// y la fecha se perdía EN SILENCIO: el campo salía vacío y el movimiento se
// guardaba con la de hoy.
check("d/m/aaaa, como se escribe aquí", dia("30/8/2026") === "30/8/2026", dia("30/8/2026"));
check("d-m-aa con año de dos cifras", dia("30-8-26") === "30/8/2026", dia("30-8-26"));
check("ambiguo 8/3: gana día primero", dia("8/3/2026") === "8/3/2026", dia("8/3/2026"));
// `new Date(2026, 1, 30)` NO falla: se desborda a marzo. Sin comprobar que sale
// lo que entró, un "30/2" acabaría guardado como 2 de marzo.
check("30 de febrero se rechaza, no se desborda a marzo", dia("30/2/2026") === null, String(dia("30/2/2026")));
check("mes 13 se rechaza", dia("2026-13-01") === null, String(dia("2026-13-01")));
check("texto que no es fecha", dia("lunes") === null, String(dia("lunes")));
check("cadena vacía", dia("") === null, String(dia("")));
check("null", dia(null) === null, String(dia(null)));

// LA TRAMPA DE LA ZONA HORARIA, que ya mordió: `new Date("2026-08-30")` es
// medianoche UTC, y en Venezuela (UTC-4) eso ES EL 29. Se vio en dev el
// 2026-09-29: la libreta decía 30 y la pantalla decía 29.
const d = diaLeido("2026-08-30");
check(
  "se construye al MEDIODÍA, no a medianoche",
  d.getHours() === 12,
  `hora local ${d.getHours()}`,
);
// Al mediodía local hay doce horas de margen por cada lado: el instante UTC
// cae en el mismo día en cualquier zona del planeta.
const utc = new Date(isoDeLaFecha("2026-08-30"));
check(
  "el día sobrevive al viaje a UTC",
  utc.getUTCDate() === 30 || utc.getUTCDate() === 29 + 1,
  `UTC ${utc.toISOString()}`,
);
check("el input date recibe YYYY-MM-DD", valorDeInputFecha("30/8/2026") === "2026-08-30", valorDeInputFecha("30/8/2026"));
check("sin fecha, el input queda vacío", valorDeInputFecha(null) === "", `"${valorDeInputFecha(null)}"`);

// ═════════════════════════════════════════════════════════════════════════
// 2. LA LÍNEA DE AJUSTE
//
// Inventa un movimiento en la deuda de una persona. Si se coloca mal, el aviso
// de "no cuadra" sigue en rojo con el ajuste ya metido; si nace sin cédula,
// bloquea la subida sin explicación.
console.log("\n── La línea de ajuste ───────────────────────────────────────");

const tresMovs = [
  mov({ amount: 40, document_id: "V-123", whatsapp: "584141112233", date: "2026-09-02" }),
  mov({ amount: 50, date: "2026-09-05" }),
  mov({ amount: 35, read_balance: 140, date: "2026-09-08" }),
];
const filaDelTotal = tresMovs[2].uid;
const ajuste = construirAjuste({
  movimientos: tresMovs,
  nombreDelCliente: "Ana",
  libro: { escrito: 140, calculado: 125, currency: "USD", filaDelTotal },
  uid: "ajuste-1",
});

check("se construye cuando hay desajuste", ajuste !== null);
check("el monto es la diferencia exacta", ajuste.movimiento.amount === 15, String(ajuste.movimiento.amount));
check("es un cargo cuando la libreta dice MÁS", ajuste.movimiento.type === "charge", ajuste.movimiento.type);
// CT-27, 2026-10-01: AL FINAL de todos los renglones, por decisión del usuario.
// Antes iba justo antes de la fila del total escrito.
check("se coloca al final de todo", ajuste.indice === tresMovs.length, `índice ${ajuste.indice}`);
// La fecha sale del ÚLTIMO renglón de su libro, porque va detrás de él. Con
// `date: null` la 076 le pondría la de HOY y lo sacaría del periodo de la
// página; la mora y el enlace del cliente leen esa misma cadena.
check("hereda la fecha del último renglón", ajuste.movimiento.date === "2026-09-08", String(ajuste.movimiento.date));
// Datos de la PERSONA, no del renglón. Naciendo en null, quien escribiera la
// cédula y DESPUÉS eligiera "mi libreta" se encontraba el botón bloqueado por
// una fila recién creada, y sin salida. Visto en dev el 2026-09-29.
check("hereda la cédula de sus hermanas", ajuste.movimiento.document_id === "V-123", String(ajuste.movimiento.document_id));
check("hereda el WhatsApp", ajuste.movimiento.whatsapp === "584141112233", String(ajuste.movimiento.whatsapp));
check("lleva la moneda del libro", ajuste.movimiento.currency === "USD", String(ajuste.movimiento.currency));
// La lee el CLIENTE en /s/[token]: `description` es el único campo del
// movimiento que devuelve get_shared_balance.
check("la descripción es la que ve el cliente", ajuste.movimiento.description === DESCRIPCION_DEL_AJUSTE, ajuste.movimiento.description);

// DOS LIBROS DEL MISMO CLIENTE SON DOS CADENAS. La fecha del ajuste en euros no
// puede salir del último renglón en dólares: lo colocaría en el sitio
// equivocado de la cadena de euros.
const mezclado = [
  mov({ amount: 20, currency: "EUR", date: "2026-09-05" }),
  mov({ amount: 12, currency: "EUR", read_balance: 35, date: "2026-09-11" }),
  mov({ amount: 40, currency: "USD", date: "2026-09-20" }),
];
const ajusteEur = construirAjuste({
  movimientos: mezclado,
  nombreDelCliente: "Ana",
  libro: { escrito: 35, calculado: 32, currency: "EUR", filaDelTotal: mezclado[1].uid },
  uid: "ajuste-eur",
});
check("el ajuste en euros toma la fecha del último renglón EN EUROS", ajusteEur.movimiento.date === "2026-09-11", String(ajusteEur.movimiento.date));
check("y no la del último en dólares", ajusteEur.movimiento.date !== "2026-09-20");

// El caso contrario: la libreta dice MENOS que los montos.
const alReves = construirAjuste({
  movimientos: tresMovs,
  nombreDelCliente: "Ana",
  libro: { escrito: 100, calculado: 125, currency: "USD", filaDelTotal },
  uid: "ajuste-2",
});
check("es un abono cuando la libreta dice MENOS", alReves.movimiento.type === "payment", alReves.movimiento.type);
check("y el monto sigue siendo positivo", alReves.movimiento.amount === 25, String(alReves.movimiento.amount));

check(
  "sin diferencia no se construye nada",
  construirAjuste({
    movimientos: tresMovs,
    nombreDelCliente: "Ana",
    libro: { escrito: 125, calculado: 125, currency: "USD", filaDelTotal },
    uid: "x",
  }) === null,
);
check(
  "sin fila de total tampoco",
  construirAjuste({
    movimientos: tresMovs,
    nombreDelCliente: "Ana",
    libro: { escrito: 140, calculado: 125, currency: "USD", filaDelTotal: null },
    uid: "x",
  }) === null,
);

// ── Lo que de verdad importa: el CIERRE acaba en lo que dice la libreta ──
//
// Y aquí está CT-27 entero. La regla vieja —cuadrar contra la PRIMERA fila que
// descuadra— solo acierta cuando el error es un desfase constante. Esta libreta
// tiene el error en medio, que es el caso del mockup M: con la regla vieja
// cerraba en 60 donde la libreta dice 50.
const errorEnMedio = [
  mov({ amount: 30, read_balance: 30, date: "2026-09-02" }),
  mov({ amount: 10, read_balance: 25, date: "2026-09-04" }), // aquí se separa
  mov({ amount: 25, read_balance: 50, date: "2026-09-06" }), // y aquí cierra
];
const librosM = agruparPorCliente(reconcileMovements(errorEnMedio, []), [], { esVE: true })[0].libros[0];
check(
  "el libro mira el ÚLTIMO total escrito, no el primer descuadre",
  librosM.escrito === 50 && librosM.calculado === 65,
  `escrito ${librosM.escrito}, calculado ${librosM.calculado}`,
);
const ajusteM = construirAjuste({
  movimientos: errorEnMedio,
  nombreDelCliente: "Ana",
  libro: librosM,
  uid: "ajuste-m",
});
check("y el ajuste es el que cierra en lo escrito", ajusteM.movimiento.amount === 15 && ajusteM.movimiento.type === "payment", `${ajusteM.movimiento.type} ${ajusteM.movimiento.amount}`);
const conAjusteM = [...errorEnMedio];
conAjusteM.splice(ajusteM.indice, 0, ajusteM.movimiento);
const libroCerrado = agruparPorCliente(reconcileMovements(conAjusteM, []), [], { esVE: true })[0].libros[0];
check(
  "el total de la página acaba siendo EXACTAMENTE el de la libreta",
  libroCerrado.totalPagina === 50,
  `totalPagina ${libroCerrado.totalPagina}`,
);
// Lo que se paga por ponerlo al final, dicho en una prueba para que nadie lo
// descubra como sorpresa: la fila de en medio SIGUE en rojo. El ajuste arregla
// el cierre, no el renglón donde la cuenta se separó.
const filasM = reconcileMovements(conAjusteM, []);
check(
  "la fila de en medio sigue marcada, y eso es correcto",
  filasM[1].review_reason === "no_cuadra",
  String(filasM[1].review_reason),
);


// ═════════════════════════════════════════════════════════════════════════
// LÍNEAS SIN CLIENTE Y SIN MONTO — CT-25
//
// Hasta el 2026-10-01 `/api/extract` las tiraba las dos en la misma línea
// (`m.client_name && m.amount > 0`) y no avisaba de ninguna. Medido ese día con
// una libreta escrita a mano: 2 movimientos leídos de 5, $35 de deuda real
// fuera, y la pantalla diciendo "Listo · 2 movimientos".
console.log("");
console.log("-- Lineas sin cliente y sin monto (CT-25) --------------------");

check("una fila sin nombre es una linea suelta", esLineaSuelta({ client_name: "" }));
check("y una con espacios tambien", esLineaSuelta({ client_name: "   " }));
check("una con nombre no lo es", !esLineaSuelta({ client_name: "Zulay Berrios" }));
check("monto 0 es una linea sin monto", esLineaSinMonto({ amount: 0 }));
check("monto negativo tambien (el signo lo lleva `type`)", esLineaSinMonto({ amount: -5 }));
check("un monto normal no lo es", !esLineaSinMonto({ amount: 18 }));

// La libreta R, tal cual: tres renglones que vienen de la hoja anterior y
// despues el nombre.
const libretaR = [
  mov({ uid: "r1", client_name: "", amount: 10, description: "harina" }),
  mov({ uid: "r2", client_name: "", amount: 0, description: "cafe" }),
  mov({ uid: "r3", client_name: "", amount: 25, description: "aceite" }),
  mov({ uid: "r4", client_name: "Zulay Berrios", amount: 18, description: "jabon" }),
  mov({ uid: "r5", client_name: "Zulay Berrios", amount: 8, type: "payment", description: "abono" }),
];
const partida = separarLineasSueltas(libretaR);
check("las tres huerfanas se separan", partida.sueltas.length === 3, String(partida.sueltas.length));
check("y las dos con nombre siguen su camino", partida.conCliente.length === 2, String(partida.conCliente.length));
// LO QUE ESTO EVITA: con nombre vacio, `reconcileMovements` agrupa por "" y
// fabrica una tarjeta sin nombre con los saldos de varias personas mezclados.
check(
  "ninguna suelta llega a la agrupacion por cliente",
  agruparPorCliente(reconcileMovements(partida.conCliente, []), [], { esVE: true }).every((c) => c.nameKey !== ""),
);

const pend = pendientesDeResolver(libretaR);
check("se cuentan 3 sin cliente", pend.sinCliente === 3, String(pend.sinCliente));
// El cafe en 0 NO se cuenta dos veces: ya esta contado como "sin cliente", y
// decir "3 sin cliente y 1 sin monto" sobre 3 renglones confundiria.
check("y 0 sin monto, porque el del cafe ya cuenta como sin cliente", pend.sinMonto === 0, String(pend.sinMonto));
check("el motivo del bloqueo lo dice", (motivoDeLineasPendientes(pend) ?? "").includes("3 líneas sin cliente"), String(motivoDeLineasPendientes(pend)));
check("sin nada pendiente no hay motivo", motivoDeLineasPendientes({ sinCliente: 0, sinMonto: 0 }) === null);
// EL REMEDIO QUE SE NOMBRA ES EL QUE SIRVE. La primera version listaba los tres
// siempre, asi que con una sola linea sin monto decia "asignalas a un cliente".
const soloMonto = motivoDeLineasPendientes({ sinCliente: 0, sinMonto: 1 });
check("con solo un monto que falta NO dice que la asignes a un cliente", !soloMonto.includes("cliente"), soloMonto);
check("y dice en singular lo que hay que hacer", soloMonto.includes("Escribe el monto") && soloMonto.includes("quítala"), soloMonto);
const soloCliente = motivoDeLineasPendientes({ sinCliente: 2, sinMonto: 0 });
check("con solo lineas sin cliente NO habla de montos", !soloCliente.includes("monto"), soloCliente);
check("y en plural", soloCliente.includes("Dinos de quién son") && soloCliente.includes("quítalas"), soloCliente);
const lasDos = motivoDeLineasPendientes({ sinCliente: 1, sinMonto: 2 });
check("con las dos cosas, nombra las dos y las distingue", lasDos.includes("las primeras") && lasDos.includes("las otras"), lasDos);

// Los nombres que se ofrecen: PRIMERO los de esta tanda de fotos, que son los
// que el dueno tiene delante.
const nombres = nombresParaAsignar({
  movimientos: libretaR,
  clientesDeSevenz: [{ name: "Petra Villalba" }, { name: "zulay berrios" }],
});
check("el primero es el de la libreta", nombres[0]?.nombre === "Zulay Berrios" && nombres[0]?.origen === "libreta", JSON.stringify(nombres[0]));
check("despues los de Sevenz", nombres[1]?.nombre === "Petra Villalba" && nombres[1]?.origen === "sevenz", JSON.stringify(nombres[1]));
// "Zulay Berrios" y "zulay berrios" son la misma persona: se compara en
// minusculas, igual que el resto de la revision, y se ensena la grafia de la foto.
check("no se repite el mismo nombre con otra grafia", nombres.length === 2, JSON.stringify(nombres.map((n) => n.nombre)));
check("las vacias no entran en la lista", !nombres.some((n) => n.nombre === ""));

// Asignar una: solo esa, y por uid.
const traAsignarUna = asignarLineaSuelta(libretaR, "r1", "  Zulay Berrios  ");
check("asignar escribe el nombre, sin espacios de sobra", traAsignarUna[0].client_name === "Zulay Berrios", `"${traAsignarUna[0].client_name}"`);
check("y no toca a las demas", traAsignarUna[1].client_name === "" && traAsignarUna[2].client_name === "");
// Un nombre en blanco la devuelve a "sin cliente": es como se deshace sin
// borrar la linea.
check("un nombre vacio la devuelve a sin cliente", asignarLineaSuelta(traAsignarUna, "r1", "  ")[0].client_name === "");

// Asignar todas, respetando lo que el dueno ya habia quitado. Es la misma regla
// que `recuperarCliente`: no se deshace una decision que nadie pidio deshacer.
const todas = asignarTodasLasSueltas(libretaR, "Zulay Berrios", new Set(["r2"]));
check("asignar todas alcanza a las vivas", todas[0].client_name === "Zulay Berrios" && todas[2].client_name === "Zulay Berrios");
check("pero NO resucita la que estaba quitada", todas[1].client_name === "", `"${todas[1].client_name}"`);
check("y no toca a las que ya tenian nombre", todas[3].client_name === "Zulay Berrios" && todas[4].client_name === "Zulay Berrios");
check("sin nombre no hace nada", asignarTodasLasSueltas(libretaR, "   ") === libretaR);

// Una vez asignadas, el pendiente que queda es el monto en 0, y ESE si es de la
// tarjeta: la linea ya sabe de quien es.
const yaAsignadas = asignarTodasLasSueltas(libretaR, "Zulay Berrios");
const pend2 = pendientesDeResolver(yaAsignadas);
check("asignadas todas, no queda ninguna sin cliente", pend2.sinCliente === 0, String(pend2.sinCliente));
check("pero el monto en 0 sigue pendiente", pend2.sinMonto === 1, String(pend2.sinMonto));
check("y el motivo cambia al que toca", (motivoDeLineasPendientes(pend2) ?? "").includes("1 línea sin monto"), String(motivoDeLineasPendientes(pend2)));


// ═════════════════════════════════════════════════════════════════════════
// NINGUN ERROR EN IDIOMA DE PROGRAMADOR
//
// Regla del usuario, 2026-10-01. Lo que habia era el defecto al reves: salia
// todo salvo lo que alguien tapara. El dia que el servidor se quedo sin salida
// a internet, la pantalla del dueno dijo "fetch failed".
console.log("");
console.log("-- Errores legibles ------------------------------------------");

// `mensajeDeError` escribe en console.error a proposito. Se silencia durante
// estas pruebas para no ensuciar la salida: lo que se comprueba es lo que
// DEVUELVE, no lo que registra.
const errorDeVerdad = console.error;
console.error = () => {};

const sinJerga = (m) =>
  !/fetch failed|violates|constraint|policy|undefined|null|GEMINI|Gemini|OpenRouter|TypeError|ECONNREFUSED|PGRST|[0-9]{5}/.test(m);

// EL CASO EXACTO QUE LO MOTIVO.
const red = mensajeDeError("leer la foto", new TypeError("fetch failed"), "extract");
check("'fetch failed' no llega al dueno", !red.includes("fetch failed"), red);
check("y en su lugar se explica lo que paso", red.includes("se cortó la conexión") && red.includes("leer la foto"), red);

// Un error nuevo que nadie ha visto nunca cae en el generico, no en ingles.
const raro = mensajeDeError("guardar los cambios", new Error("ECONNABORTED: upstream kaput"), "x");
check("un error desconocido NO se filtra", !raro.includes("kaput") && !raro.includes("ECONNABORTED"), raro);
check("y dice que se puede reintentar y a quien escribir", raro.includes("Inténtalo otra vez") && raro.includes("escríbenos"), raro);

// Postgres, tal como llega de Supabase.
const rls = mensajeDeError("guardar el movimiento", { code: "42501", message: "new row violates row-level security policy for table movements" }, "x");
check("una violacion de RLS no se enseña como tal", sinJerga(rls), rls);
const dup = mensajeDeError("guardar los cambios", { code: "23505", message: 'duplicate key value violates unique constraint "clients_owner_id_document_id_key"' }, "x");
check("la cedula repetida se dice en cristiano", dup.includes("otro cliente con esa cédula") && sinJerga(dup), dup);
const dup2 = mensajeDeError("guardar los cambios", { code: "23505", message: 'duplicate key value violates unique constraint "otra_cosa"' }, "x");
check("y una clave repetida cualquiera, tambien", dup2.includes("ya está registrado") && sinJerga(dup2), dup2);
const chk = mensajeDeError("guardar el movimiento", { code: "23514", message: "violates check constraint movements_plazo_dias_check" }, "x");
check("el check constraint del plazo tampoco se enseña", sinJerga(chk), chk);

// Storage: sin codigo, mensaje en ingles del servicio.
const grande = mensajeDeError("guardar la foto", { message: "The object exceeded the maximum allowed size" }, "x");
check("una foto demasiado grande lo dice en cristiano", grande.includes("pesa demasiado") && sinJerga(grande), grande);

// Lo nuestro pasa tal cual, y se reconoce por la CLASE, no por el texto: mirar
// el string para decidir si un mensaje es nuestro da una respuesta siempre y no
// mide nada, que es el mismo error que el `confidence` del modelo.
const mio = mensajeDeError("leer la foto", new ErrorParaElDueno("Ahora mismo hay muchas libretas en cola. Espera un minuto y vuelve a intentarlo."), "x");
check("un mensaje nuestro sale entero y sin prefijo", mio === "Ahora mismo hay muchas libretas en cola. Espera un minuto y vuelve a intentarlo.", mio);

// La accion se nombra SIEMPRE, para que se lea que no pasó antes que qué hacer.
check("la frase dice que se estaba intentando", mensajeDeError("mover el cliente a la papelera", new Error("x"), "y").startsWith("No pudimos mover el cliente a la papelera"));

// Y el detalle de verdad no se pierde: se registra desde dentro, no en cada
// sitio que llama, porque lo que se delega a veintitres sitios se olvida.
let registrado = null;
console.error = (...args) => { registrado = args; };
mensajeDeError("guardar el logo", new Error("detalle interno que importa"), "logo");
console.error = () => {};
check("el error real SI se registra en el servidor", registrado && String(registrado[1]).includes("detalle interno que importa"), JSON.stringify(registrado?.map(String)));
check("y con su contexto para poder buscarlo", registrado && registrado[0] === "[logo]", String(registrado?.[0]));

console.error = errorDeVerdad;


// La normalizacion de la cedula es la que decide si dos fichas son la misma
// persona, en crear, en importar y —desde CT-28, 2026-10-01— en editar. El
// documento se guarda TAL COMO SE TECLEA, sin formato fijo, asi que comparar
// en crudo deja pasar al mismo humano dos veces.
console.log("");
console.log("-- La cedula se compara normalizada ---------------------------");
check("los puntos no cuentan", normalizeDocumentId("19.887.766") === normalizeDocumentId("19887766"));
check("el prefijo V- tampoco", normalizeDocumentId("V-19887766") === "v19887766", normalizeDocumentId("V-19887766"));
check("ni las mayusculas", normalizeDocumentId("V-19887766") === normalizeDocumentId("v.19.887.766"));
check("dos documentos distintos siguen siendo distintos", normalizeDocumentId("19887766") !== normalizeDocumentId("18223344"));

// ═════════════════════════════════════════════════════════════════════════
// 3. QUITAR Y RECUPERAR
console.log("\n── Quitar y recuperar ───────────────────────────────────────");

let estado = { eliminados: new Set(), porCliente: {} };
estado = quitarMovimiento(estado, "a1");
check("quitar un movimiento lo marca", estado.eliminados.has("a1"));
estado = recuperarMovimiento(estado, "a1");
check("recuperarlo lo desmarca", !estado.eliminados.has("a1"));

// EL CASO QUE IMPORTA: el dueño quita un renglón suelto y DESPUÉS al cliente
// entero. Al recuperar al cliente, ese renglón NO debe volver — lo quitó a
// propósito, y devolverlo sería deshacer una decisión que nadie pidió deshacer.
let e2 = { eliminados: new Set(), porCliente: {} };
e2 = quitarMovimiento(e2, "b1");
e2 = quitarCliente(e2, "beto", ["b1", "b2"]);
check("quitar al cliente se lleva lo que quedaba vivo", e2.eliminados.has("b1") && e2.eliminados.has("b2"));
check("y apunta solo lo que ESA eliminación se llevó", JSON.stringify(e2.porCliente.beto) === '["b2"]', JSON.stringify(e2.porCliente.beto));
e2 = recuperarCliente(e2, "beto");
check("recuperar al cliente devuelve sus renglones", !e2.eliminados.has("b2"));
check(
  "pero NO resucita el que el dueño había quitado antes",
  e2.eliminados.has("b1"),
  e2.eliminados.has("b1") ? "b1 sigue quitado" : "b1 revivió",
);

// ═════════════════════════════════════════════════════════════════════════
// 4. QUÉ ESTADO TIENE CADA TARJETA
//
// Es lo que IMPIDE subir, y la prioridad no es estética: primero lo que bloquea,
// después lo que hay que decidir, al final lo que conviene mirar.
console.log("\n── El estado de la tarjeta ──────────────────────────────────");

const cliente = (p = {}) => ({
  nameKey: "ana",
  name: "Ana",
  rowIds: ["r1"],
  movimientos: 1,
  candidato: null,
  libros: [{ currency: "USD", totalPagina: 10, saldoPrevio: 0, saldoFinal: 10, estado: "cuadra", escrito: null, calculado: null, filaDelTotal: null }],
  necesitaDocumento: false,
  necesitaMoneda: false,
  faltaWhatsapp: false,
  ...p,
});
const fila = (p = {}) => ({ client_name: "Ana", document_id: null, needs_document_id: false, ...p });
const candidato = { id: "c1", name: "Ana", document_id: "V-9", whatsapp: null, balance: 0, balance_usd: 40, balance_eur: 0 };
const estadoDe = (c, fs, dec = {}, cand = new Map(), op = {}) =>
  conEstado([c], fs, dec, cand, op)[0];

check(
  "sin cédula, la tarjeta bloquea",
  estadoDe(cliente(), [fila({ needs_document_id: true })]).estado === "faltan_datos",
);
// La tarjeta y el pie tienen que medir LO MISMO, fila a fila. Antes una
// preguntaba si ALGUNA traía cédula y el otro si le FALTABA a alguna: con una
// sola fila sin ella la tarjeta decía "Todo cuadra" y el botón estaba apagado.
check(
  "basta UNA fila sin cédula para bloquear, aunque otra la traiga",
  estadoDe(cliente(), [
    fila({ needs_document_id: true, document_id: "V-1" }),
    fila({ needs_document_id: true }),
  ]).estado === "faltan_datos",
);
check(
  "la cédula que falta gana al duplicado sin decidir",
  estadoDe(cliente(), [fila({ needs_document_id: true })], {}, new Map([["ana", candidato]])).estado === "faltan_datos",
);
check(
  "un duplicado sin decidir bloquea",
  estadoDe(cliente(), [fila()], {}, new Map([["ana", candidato]])).estado === "duplicado",
);
check(
  "decidido, deja de bloquear",
  estadoDe(cliente(), [fila()], { ana: "mismo" }, new Map([["ana", candidato]])).estado === "cuadra",
);
check(
  "una suma que no cuadra gana a 'sin verificar'",
  estadoDe(
    cliente({ libros: [{ ...cliente().libros[0], estado: "no_cuadra" }, { ...cliente().libros[0], currency: "EUR", estado: "sin_verificar" }] }),
    [fila()],
  ).estado === "revisar_suma",
);
check(
  "sin totales con los que comparar: ámbar, no rojo",
  estadoDe(cliente({ libros: [{ ...cliente().libros[0], estado: "sin_verificar" }] }), [fila()]).estado === "sin_verificar",
);
// El WhatsApp NUNCA bloquea: es opcional en todas partes desde el 2026-09-21.
const sinWa = estadoDe(cliente({ faltaWhatsapp: true }), [fila()]);
check("el WhatsApp que falta NO bloquea", sinWa.estado === "cuadra" && sinWa.bloqueos.length === 0);
check("pero sí avisa", sinWa.avisos.some((a) => a.includes("WhatsApp")));

// ═════════════════════════════════════════════════════════════════════════
// 5. LOS DOS LIBROS DE UNA CARTERA MIXTA
//
// Un $50 y un €20 son dos deudas independientes. Sumarlas daría "70" de nada, y
// el número saldría plausible — que es lo que lo hace peligroso.
console.log("\n── Cartera mixta ────────────────────────────────────────────");

const mixta = reconcileMovements(
  [mov({ amount: 50, currency: "USD" }), mov({ amount: 20, currency: "EUR" })],
  [],
);
const libros = agruparPorCliente(mixta, [], { esVE: true })[0].libros;
check("dos monedas dan dos libros", libros.length === 2, `${libros.length} libros`);
check(
  "y cada uno lleva SU total, sin mezclarse",
  libros.find((l) => l.currency === "USD").totalPagina === 50 &&
    libros.find((l) => l.currency === "EUR").totalPagina === 20,
  libros.map((l) => `${l.currency}=${l.totalPagina}`).join(" "),
);

// ── El ajuste se mantiene al dia ─────────────────────────────────────────
//
// `construirAjuste` crea la linea una vez; `reconciliarAjuste` la mantiene
// cuadrando cuando el dueno sigue tocando la libreta DESPUES de haber elegido.
// El fallo que esto cubre se midio en dev el 2026-10-01: ajuste de +25 creado,
// luego se corrige un monto, y el ajuste seguia en 25 — se importaba 100 donde
// la libreta decia 95.
console.log("");
console.log("-- El ajuste se mantiene al dia ------------------------------");
// Desde el 2026-10-01 el ajuste NO se guarda: se deriva en cada render de la
// decision del dueno y del LIBRO SOMBRA — la reconciliacion hecha sobre los
// renglones SIN las lineas de ajuste.
//
// El fallo que esto cubre se midio en dev ese dia: el ajuste se creaba una vez
// y se quedaba. Ajuste de +25 sobre una libreta que decia 95; se corregia un
// renglon y se acababa importando 100. El panel seguia diciendo "la suma de
// Sevenz: $70" y "agregaremos $25 para que cuadren las cuentas".
//
// Lo que se prueba aqui es que construirAjuste, alimentado con la sombra, da
// SIEMPRE la linea que cuadra con lo que hay en ese momento.
const sombra = (escrito, calculado, ancla = "c") => ({
  escrito,
  calculado,
  // La misma moneda que `mov()` pone en las filas: los libros se derivan de las
  // propias filas, asi que en la app nunca discrepan.
  currency: "USD",
  filaDelTotal: ancla,
});
const renglones = [
  mov({ uid: "a", amount: 50 }),
  mov({ uid: "b", amount: 40 }),
  mov({ uid: "c", amount: 20, type: "payment" }),
];
const derivar = (libro, movimientos = renglones) =>
  construirAjuste({ movimientos, nombreDelCliente: movimientos[0].client_name, libro, uid: "ajuste:x" });

const recien = derivar(sombra(95, 70));
check(
  "con desajuste, sale la linea por la diferencia exacta",
  recien && recien.movimiento.amount === 25 && recien.movimiento.type === "charge",
  recien && `${recien.movimiento.amount} ${recien.movimiento.type}`,
);

// EL CASO QUE SE ESCAPO: el arroz pasa de 40 a 45, asi que la suma sube a 75.
const traEditar = derivar(sombra(95, 75));
check(
  "si cambia un monto, la linea sale ya por el importe nuevo (25 -> 20)",
  traEditar && traEditar.movimiento.amount === 20,
  traEditar && String(traEditar.movimiento.amount),
);

check("si ya cuadra exactamente, NO hay linea (no se queda en 0)", derivar(sombra(95, 95)) === null);

const flip = derivar(sombra(70, 95));
check(
  "si la suma pasa del total escrito, la linea es un abono",
  flip && flip.movimiento.type === "payment" && flip.movimiento.amount === 25,
  flip && `${flip.movimiento.type} ${flip.movimiento.amount}`,
);

check(
  "si la fila que llevaba el total escrito desaparece, no hay linea",
  derivar(sombra(95, 70, null)) === null,
);

// IDEMPOTENCIA / CONVERGENCIA. Al derivarse en cada render, lo que importa es
// que la sombra NO cambie al meter la linea: si cambiara, el calculo se
// perseguiria a si mismo. La sombra se reconcilia sin los ajustes, asi que dos
// pasadas sobre el mismo estado dan lo mismo.
const unaVez = derivar(sombra(95, 70));
const conLaLinea = [...renglones];
conLaLinea.splice(unaVez.indice, 0, unaVez.movimiento);
const otraVez = derivar(sombra(95, 70), renglones);
check(
  "derivarlo dos veces sobre la misma sombra da lo mismo (converge)",
  otraVez.movimiento.amount === unaVez.movimiento.amount &&
    otraVez.movimiento.type === unaVez.movimiento.type,
  `${unaVez.movimiento.amount} == ${otraVez.movimiento.amount}`,
);
check(
  "y la linea entra LA ULTIMA, detras de todos los renglones (CT-27)",
  conLaLinea[conLaLinea.length - 1].uid === "ajuste:x" && conLaLinea.length === renglones.length + 1,
  conLaLinea.map((m) => m.uid).join(","),
);

check(
  "el ajuste hereda la FECHA del ultimo renglon de su libro",
  (() => {
    const conFechas = [
      mov({ uid: "a", amount: 50, date: "2026-09-12" }),
      mov({ uid: "b", amount: 40, date: "2026-09-13" }),
      mov({ uid: "c", amount: 20, type: "payment", date: "2026-09-15" }),
    ];
    const r = construirAjuste({
      movimientos: conFechas,
      nombreDelCliente: conFechas[0].client_name,
      libro: sombra(95, 70, "c"),
      uid: "ajuste:x",
    });
    return r.movimiento.date === "2026-09-15";
  })(),
);
check(
  "si el ancla no trae fecha, el ajuste tampoco (manda la de subida)",
  (() => {
    const r = construirAjuste({
      movimientos: renglones,
      nombreDelCliente: renglones[0].client_name,
      libro: sombra(95, 70, "c"),
      uid: "ajuste:x",
    });
    return r.movimiento.date === null;
  })(),
);

check(
  "el uid se deriva de la clave: estable entre renders, sin guardar nada",
  unaVez.movimiento.uid === "ajuste:x",
);

console.log("");
console.log("-- Subir cliente por cliente --------------------------------");
// Desde el 2026-10-01 cada cliente se puede subir por separado, asi que lo que
// antes era un bloqueo de la tanda pasa a decidirse por persona: `puedeSubir`
// es lo que enciende su boton y lo que cuenta el del lote.
const conMoneda = (p = {}) => fila({ currency: "USD", ...p });

check(
  "cliente completo -> se puede subir",
  estadoDe(cliente(), [conMoneda()], {}, new Map(), { exigeMoneda: true }).puedeSubir === true,
);
check(
  "sin cedula -> no se puede subir",
  estadoDe(cliente(), [conMoneda({ needs_document_id: true })], {}, new Map(), { exigeMoneda: true })
    .puedeSubir === false,
);
check(
  "sin moneda en un negocio VE -> no se puede subir, y lo dice",
  (() => {
    const e = estadoDe(cliente(), [fila()], {}, new Map(), { exigeMoneda: true });
    return e.puedeSubir === false && e.bloqueos.some((b) => b.includes("moneda"));
  })(),
);
check(
  "sin moneda en un negocio CO -> SI se puede subir (alli no se elige moneda)",
  (() => {
    const e = estadoDe(cliente(), [fila()], {}, new Map(), { exigeMoneda: false });
    return e.puedeSubir === true && e.bloqueos.length === 0;
  })(),
);
check(
  "duplicado sin decidir -> no se puede subir",
  estadoDe(cliente(), [conMoneda()], {}, new Map([["ana", candidato]]), { exigeMoneda: true })
    .puedeSubir === false,
);
check(
  "duplicado ya decidido -> se puede subir",
  estadoDe(cliente(), [conMoneda()], { ana: "mismo" }, new Map([["ana", candidato]]), {
    exigeMoneda: true,
  }).puedeSubir === true,
);
check(
  "un cliente YA subido no se vuelve a subir",
  (() => {
    const e = estadoDe(cliente(), [conMoneda()], {}, new Map(), {
      exigeMoneda: true,
      subidos: new Set(["ana"]),
    });
    return e.subido === true && e.puedeSubir === false;
  })(),
);
check(
  "la suma que no cuadra NO impide subir: el dueno decide",
  estadoDe(cliente({ libros: [{ currency: "USD", estado: "no_cuadra", escrito: 95, calculado: 70 }] }), [conMoneda()], {}, new Map(), { exigeMoneda: true })
    .puedeSubir === true,
);

console.log("");
console.log("-- La revision sobrevive a una recarga -----------------------");
// sessionStorage no existe en Node, asi que el almacen se inyecta. Es la misma
// funcion que corre en el navegador, no una copia.
const almacenFalso = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _romper(k, v) { m.set(k, v); },
    _clave: () => [...m.keys()][0],
  };
};
const unaRevision = {
  movimientos: [mov({ uid: "a", amount: 50 })],
  eliminados: ["b"],
  clientesQuitados: { ana: ["b"] },
  decisiones: { ana: "mismo" },
  decisionesDeTotal: { "ana|USD": { cual: "libreta", escrito: 95, calculado: 70 } },
  subidos: ["otra"],
  sameClient: true,
  sharedName: "Ana",
  sharedDocument: "V-1",
  sharedWhatsapp: "+58400",
  unlinked: ["c"],
};

let al = almacenFalso();
guardarRevision(unaRevision, al);
const vuelta = cargarRevision(Date.now(), al);
check(
  "lo guardado vuelve entero",
  vuelta &&
    vuelta.movimientos.length === 1 &&
    vuelta.eliminados[0] === "b" &&
    vuelta.decisiones.ana === "mismo" &&
    vuelta.sharedName === "Ana" &&
    vuelta.sameClient === true &&
    vuelta.unlinked[0] === "c",
);

check("sin nada guardado devuelve null", cargarRevision(Date.now(), almacenFalso()) === null);

al = almacenFalso();
guardarRevision(unaRevision, al);
check(
  "caducado a las 24h -> null, y se borra",
  cargarRevision(Date.now() + 25 * 60 * 60 * 1000, al) === null && cargarRevision(Date.now(), al) === null,
);

al = almacenFalso();
guardarRevision(unaRevision, al);
olvidarRevision(al);
check("olvidar lo borra", cargarRevision(Date.now(), al) === null);

al = almacenFalso();
guardarRevision(unaRevision, al);
al._romper(al._clave(), "{esto no es json");
check("un blob corrupto no revienta: devuelve null", cargarRevision(Date.now(), al) === null);

al = almacenFalso();
guardarRevision(unaRevision, al);
al._romper(al._clave(), JSON.stringify({ version: 99, guardadaEn: Date.now(), movimientos: [mov()] }));
check("otra version se tira en vez de usarse", cargarRevision(Date.now(), al) === null);

al = almacenFalso();
guardarRevision({ ...unaRevision, movimientos: [] }, al);
check("sin movimientos no se recupera nada", cargarRevision(Date.now(), al) === null);


// CT-26: `revisada` distingue "dejo la revision a medias" de "ni la abrio".
al = almacenFalso();
guardarRevision({ ...unaRevision, revisada: false }, al);
check("lo guardado sin revisar vuelve como no revisado", cargarRevision(Date.now(), al).revisada === false);
al = almacenFalso();
guardarRevision({ ...unaRevision, revisada: true }, al);
check("y lo revisado, como revisado", cargarRevision(Date.now(), al).revisada === true);
// Un borrador de la version 1 no traia el campo, y solo se escribia con la
// revision abierta: leerlo como `true` es leerlo como lo que era.
al = almacenFalso();
guardarRevision(unaRevision, al);
al._romper(al._clave(), JSON.stringify({ version: 1, guardadaEn: Date.now(), movimientos: [mov()], eliminados: [] }));
check("un borrador sin el campo se lee como revisado", cargarRevision(Date.now(), al).revisada === true);
// EL CASO DE MODO PRIVADO: el almacen LANZA en vez de devolver null.
const almacenQueLanza = {
  getItem() { throw new Error("bloqueado"); },
  setItem() { throw new Error("bloqueado"); },
  removeItem() { throw new Error("bloqueado"); },
};
let reventó = false;
try {
  guardarRevision(unaRevision, almacenQueLanza);
  check("guardar con el almacen bloqueado no lanza", cargarRevision(Date.now(), almacenQueLanza) === null);
} catch {
  reventó = true;
}
check("ni guardar ni cargar lanzan si el navegador lo bloquea", reventó === false);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
