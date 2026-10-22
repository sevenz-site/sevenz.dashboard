// NO TOCA LA BASE DE DATOS. Son números.
//
// Prueba `repartir()` y el orden por gravedad: cómo cae un abono entre varios
// fiados antes de que nada se guarde.
//
// ===========================================================================
// POR QUÉ ESTO SE PRUEBA SIN NAVEGADOR, Y POR QUÉ IMPORTA
//
// Un reparto mal calculado NO ROMPE NADA VISIBLE: suma, se guarda, la pantalla
// dice que todo bien. La diferencia la descubre el tendero semanas después,
// cuando la app le contradice lo que recuerda haber acordado con su cliente —
// que es la misma forma de fallar que el campo de cuotas que se quedó sin
// poner en un formulario y nadie notó hasta que el dueño miró la pantalla.
//
// Lo que se puede comprobar con aritmética se comprueba con aritmética: es la
// única parte de este flujo que no depende de que alguien haga clic bien.
import { repartir, deudaDelLibro } from "../lib/abonos/reparto.ts";
import { vencimientoEfectivo, porGravedad } from "../lib/estado-del-plazo.ts";

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

// Un instante fijo, para que la prueba no dependa de cuándo se corre. Las
// fechas de abajo se escriben en días RELATIVOS a él.
const AHORA = new Date("2026-10-22T12:00:00.000Z");
const hace = (dias) => new Date(AHORA.getTime() - dias * 86400000).toISOString();

const fiado = (id, { pendiente, amount = pendiente, dias, plazo = null, cuotas = null }) => ({
  movementId: id,
  createdAt: hace(dias),
  plazoDias: plazo,
  cuotas,
  amount,
  pendiente,
});

// ── 1. El vencimiento efectivo ───────────────────────────────────────────
{
  // Sin plazo no hay nada que vencer.
  const r = vencimientoEfectivo({
    createdAt: hace(100),
    plazoDias: null,
    cuotas: null,
    amount: 50,
    pendiente: 50,
    ahora: AHORA,
  });
  check("sin plazo, el vencimiento es null", r === null, String(r));
}
{
  // Pago único: su fecha más su plazo.
  const r = vencimientoEfectivo({
    createdAt: hace(10),
    plazoDias: 7,
    cuotas: null,
    amount: 50,
    pendiente: 50,
    ahora: AHORA,
  });
  const esperado = AHORA.getTime() - 3 * 86400000;
  check("pago único: vence a los `plazo` días de su fecha", Math.abs(r.getTime() - esperado) < 1000, r?.toISOString());
}
{
  // LA FILA QUE JUSTIFICA QUE ESTO NO SEA `createdAt + plazo`.
  //
  // Un fiado de 5 cuotas a 100 días, nacido hace 70, con solo la primera
  // cubierta. Su fecha FINAL está 30 días en el futuro, así que juzgarlo por
  // ella diría «dentro del plazo» — y su cuota 2 venció hace 30 días.
  //
  // La primera versión de esta fila daba por hecho que la cuota 3 de un fiado
  // de hace 50 días estaba vencida, y vencía dentro de 10. La prueba salió
  // roja con la función correcta: el número se comprueba, no se supone.
  const r = vencimientoEfectivo({
    createdAt: hace(70),
    plazoDias: 100,
    cuotas: 5,
    amount: 500,
    pendiente: 400,
    ahora: AHORA,
  });
  const cuota2 = AHORA.getTime() - 30 * 86400000;
  const fechaFinal = AHORA.getTime() + 30 * 86400000;
  check(
    "con cuotas, vence por la primera NO cubierta y no por la fecha final",
    r != null && Math.abs(r.getTime() - cuota2) < 1000 && r.getTime() < AHORA.getTime(),
    `${r?.toISOString()} — la fecha final sería ${new Date(fechaFinal).toISOString()}`,
  );
}

// ── 2. El orden por gravedad ─────────────────────────────────────────────
{
  const alDia = fiado("al-dia", { pendiente: 10, dias: 1, plazo: 30 });
  const vencido = fiado("vencido", { pendiente: 10, dias: 40, plazo: 7 });
  const sinPlazo = fiado("sin-plazo", { pendiente: 10, dias: 200 });
  const masVencido = fiado("mas-vencido", { pendiente: 10, dias: 90, plazo: 7 });

  const orden = [alDia, sinPlazo, vencido, masVencido]
    .sort(porGravedad(AHORA))
    .map((f) => f.movementId);

  check(
    "el más vencido primero, el que está al día el último",
    orden[0] === "mas-vencido" && orden.at(-1) === "al-dia",
    orden.join(" → "),
  );
  // EL SIN PLAZO CUENTA COMO VENCIDO, por la fecha en que se tomó —es el
  // `coalesce(vence, charge_at)` de la `134`—. Lleva 200 días ahí, así que va
  // por delante del que está al día; y detrás de los que SÍ tenían plazo,
  // porque esa es la segunda clave y la decisión del dueño del 2026-10-21.
  check(
    "entre vencidos, el que TENÍA plazo va antes que el que no lo tuvo nunca",
    orden.indexOf("vencido") < orden.indexOf("sin-plazo"),
    orden.join(" → "),
  );
  check(
    "y un fiado sin plazo de hace 200 días no va al final: está vencido",
    orden.indexOf("sin-plazo") < orden.indexOf("al-dia"),
    orden.join(" → "),
  );
}

// ── 3. El reparto automático ─────────────────────────────────────────────
const tres = [
  fiado("a", { pendiente: 50, dias: 43, plazo: 7 }),
  fiado("b", { pendiente: 50, dias: 31, plazo: 7 }),
  fiado("c", { pendiente: 10, dias: 2, plazo: 30 }),
];

{
  const r = repartir({ monto: 60, fiados: tres, ahora: AHORA });
  check(
    "60 sobre 50+50+10 cae 50 al más grave y 10 al siguiente",
    r.lineas[0].asignado === 50 && r.lineas[1].asignado === 10 && r.lineas[2].asignado === 0,
    r.lineas.map((l) => `${l.movementId}:${l.asignado}`).join(" "),
  );
  check("y no queda nada sin asignar", r.sinAsignar === 0 && r.repartido === 60, JSON.stringify(r.sinAsignar));
}
{
  // Ningún fiado recibe más de lo que debe, por grande que sea el monto.
  const r = repartir({ monto: 500, fiados: tres, ahora: AHORA });
  const excede = r.lineas.some((l, i) => l.asignado > [50, 50, 10][i] + 0.005);
  check("ninguna línea supera lo que ESE fiado debe", !excede, r.lineas.map((l) => l.asignado).join(" "));
  check(
    "lo que no cabe en ningún fiado se devuelve como sinAsignar",
    Math.abs(r.sinAsignar - 390) < 0.005,
    String(r.sinAsignar),
  );
}
{
  check("deudaDelLibro suma lo pendiente, no lo original", deudaDelLibro(tres) === 110, String(deudaDelLibro(tres)));
}

// ── 4. Lo puesto a mano manda, y lo demás se recalcula ───────────────────
{
  // EL CASO DE LA PANTALLA: el tendero entra al segundo fiado y le pone 4.
  // Los otros dos se recalculan con lo que queda, sin que él los toque.
  const r = repartir({ monto: 60, fiados: tres, aMano: { b: 4 }, ahora: AHORA });
  const b = r.lineas.find((l) => l.movementId === "b");
  const a = r.lineas.find((l) => l.movementId === "a");
  const c = r.lineas.find((l) => l.movementId === "c");
  check(
    "lo fijado a mano se respeta y el resto se recalcula",
    b.asignado === 4 && b.aMano === true && a.asignado === 50 && c.asignado === 6,
    `a:${a.asignado} b:${b.asignado} c:${c.asignado}`,
  );
  check("y la suma sigue siendo el monto tecleado", r.repartido === 60 && r.sinAsignar === 0, String(r.repartido));
}
{
  // A mano por encima de lo que ese fiado debe: se topa, no se acepta.
  const r = repartir({ monto: 60, fiados: tres, aMano: { c: 999 }, ahora: AHORA });
  const c = r.lineas.find((l) => l.movementId === "c");
  check("lo fijado a mano también se topa a lo que ese fiado debe", c.asignado === 10, String(c.asignado));
}

// ── 5. Los bordes que no rompen nada y por eso se prueban ────────────────
{
  const r = repartir({ monto: 0, fiados: tres, ahora: AHORA });
  check(
    "monto 0: todas las líneas a cero, ninguna negativa",
    r.lineas.every((l) => l.asignado === 0) && r.repartido === 0,
    JSON.stringify(r.repartido),
  );
}
{
  const r = repartir({ monto: 10, fiados: [], ahora: AHORA });
  check("sin fiados no hay líneas y el monto queda sin asignar", r.lineas.length === 0 && r.sinAsignar === 10, "");
}
{
  // LA FILA DE LOS CÉNTIMOS. Sin redondear en cada paso, restar tres veces
  // deja 59,699999999999996 arrastrándose y la última línea sale con una
  // cifra que nadie escribió.
  const centimos = [
    fiado("x", { pendiente: 0.1, dias: 40, plazo: 7 }),
    fiado("y", { pendiente: 0.1, dias: 30, plazo: 7 }),
    fiado("z", { pendiente: 0.1, dias: 20, plazo: 7 }),
  ];
  const r = repartir({ monto: 0.3, fiados: centimos, ahora: AHORA });
  check(
    "tres céntimos exactos no dejan cola decimal",
    r.repartido === 0.3 && r.sinAsignar === 0 && r.lineas.every((l) => l.asignado === 0.1),
    `repartido ${r.repartido} · sinAsignar ${r.sinAsignar}`,
  );
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
