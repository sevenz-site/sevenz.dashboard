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
import { reconcileMovements, agruparPorCliente } from "../lib/reconcile.ts";

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
  mov({ amount: 40, document_id: "V-123", whatsapp: "584141112233" }),
  mov({ amount: 50 }),
  mov({ amount: 35, read_balance: 140 }),
];
const desajustada = tresMovs[2].uid;
const ajuste = construirAjuste({
  movimientos: tresMovs,
  nombreDelCliente: "Ana",
  libro: { escrito: 140, calculado: 125, currency: "USD", filaDesajustada: desajustada },
  uid: "ajuste-1",
});

check("se construye cuando hay desajuste", ajuste !== null);
check("el monto es la diferencia exacta", ajuste.movimiento.amount === 15, String(ajuste.movimiento.amount));
check("es un cargo cuando la libreta dice MÁS", ajuste.movimiento.type === "charge", ajuste.movimiento.type);
// JUSTO ANTES de la fila del total escrito. El saldo corrido se comprueba EN
// esa fila, así que puesto después no cambiaría nada.
check("se coloca justo antes de la fila desajustada", ajuste.indice === 2, `índice ${ajuste.indice}`);
// Datos de la PERSONA, no del renglón. Naciendo en null, quien escribiera la
// cédula y DESPUÉS eligiera "mi libreta" se encontraba el botón bloqueado por
// una fila recién creada, y sin salida. Visto en dev el 2026-09-29.
check("hereda la cédula de sus hermanas", ajuste.movimiento.document_id === "V-123", String(ajuste.movimiento.document_id));
check("hereda el WhatsApp", ajuste.movimiento.whatsapp === "584141112233", String(ajuste.movimiento.whatsapp));
check("lleva la moneda del libro", ajuste.movimiento.currency === "USD", String(ajuste.movimiento.currency));
// La lee el CLIENTE en /s/[token]: `description` es el único campo del
// movimiento que devuelve get_shared_balance.
check("la descripción es la que ve el cliente", ajuste.movimiento.description === DESCRIPCION_DEL_AJUSTE, ajuste.movimiento.description);

// El caso contrario: la libreta dice MENOS que los montos.
const alReves = construirAjuste({
  movimientos: tresMovs,
  nombreDelCliente: "Ana",
  libro: { escrito: 100, calculado: 125, currency: "USD", filaDesajustada: desajustada },
  uid: "ajuste-2",
});
check("es un abono cuando la libreta dice MENOS", alReves.movimiento.type === "payment", alReves.movimiento.type);
check("y el monto sigue siendo positivo", alReves.movimiento.amount === 25, String(alReves.movimiento.amount));

check(
  "sin diferencia no se construye nada",
  construirAjuste({
    movimientos: tresMovs,
    nombreDelCliente: "Ana",
    libro: { escrito: 125, calculado: 125, currency: "USD", filaDesajustada: desajustada },
    uid: "x",
  }) === null,
);
check(
  "sin fila desajustada tampoco",
  construirAjuste({
    movimientos: tresMovs,
    nombreDelCliente: "Ana",
    libro: { escrito: 140, calculado: 125, currency: "USD", filaDesajustada: null },
    uid: "x",
  }) === null,
);

// Y lo que de verdad importa: que METIDO EN SU SITIO, las cuentas cuadren.
const conAjuste = [...tresMovs];
conAjuste.splice(ajuste.indice, 0, ajuste.movimiento);
const reconciliado = reconcileMovements(conAjuste, []);
const filaDelTotal = reconciliado.find((r) => r.read_balance === 140);
check(
  "con el ajuste en su sitio, la fila del total CUADRA",
  filaDelTotal.review_reason !== "no_cuadra" && filaDelTotal.page_balance === 140,
  `page_balance ${filaDelTotal.page_balance}, motivo ${filaDelTotal.review_reason}`,
);

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
  libros: [{ currency: "USD", totalPagina: 10, saldoPrevio: 0, saldoFinal: 10, estado: "cuadra", escrito: null, calculado: null, filaDesajustada: null }],
  necesitaDocumento: false,
  necesitaMoneda: false,
  faltaWhatsapp: false,
  ...p,
});
const fila = (p = {}) => ({ client_name: "Ana", document_id: null, needs_document_id: false, ...p });
const candidato = { id: "c1", name: "Ana", document_id: "V-9", whatsapp: null, balance: 0, balance_usd: 40, balance_eur: 0 };
const estadoDe = (c, fs, dec = {}, cand = new Map()) => conEstado([c], fs, dec, cand)[0];

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

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
