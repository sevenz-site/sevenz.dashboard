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
import {
  repartir,
  deudaDelLibro,
  repartirEnBolivares,
  deudaEnBolivares,
  resolveSplitUnits,
  absorbLedgerCents,
  absorbPinnedCents,
} from "../lib/abonos/reparto.ts";
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
{
  // EL CASO QUE LLEGÓ A PANTALLA EL 2026-10-22: teclear 1 y fijar 7 a mano.
  //
  // No rompía nada. La 1/2 enseñaba el campo en «1» y el botón en «Pagar y
  // finalizar $7.00» —dos cifras contradictorias a la vez— y se guardaban 7.
  // Decisión del dueño ese día: manda lo tecleado.
  const r = repartir({ monto: 1, fiados: tres, aMano: { b: 7 }, ahora: AHORA });
  const b = r.lineas.find((l) => l.movementId === "b");
  check(
    "lo fijado a mano NO puede pasarse del monto tecleado",
    b.asignado === 1 && r.repartido === 1,
    `b:${b.asignado} repartido:${r.repartido}`,
  );
  check(
    "y entonces sinAsignar nunca sale negativo",
    r.sinAsignar === 0,
    String(r.sinAsignar),
  );
}
{
  // DOS LÍNEAS A MANO QUE NO CABEN JUNTAS. 60 tecleados, 50 y 50 pedidos: el
  // recorte cae sobre la menos grave, no sobre las dos a partes iguales.
  const r = repartir({ monto: 60, fiados: tres, aMano: { a: 50, b: 50 }, ahora: AHORA });
  const a = r.lineas.find((l) => l.movementId === "a");
  const b = r.lineas.find((l) => l.movementId === "b");
  check(
    "entre dos a mano que no caben, la del fiado más grave sobrevive entera",
    a.asignado === 50 && b.asignado === 10 && r.repartido === 60,
    `a:${a.asignado} b:${b.asignado}`,
  );
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

// ── 6. EL REPARTO QUE CRUZA LIBROS ───────────────────────────────────────
//
// Migración `141` y `repartirEnBolivares`: el tendero recibe BOLÍVARES y el
// billete cae por gravedad sobre todos los fiados, estén en dólares o en
// euros. Decisión del dueño del 2026-10-23.
//
// LAS TASAS SON INVENTADAS Y REDONDAS a propósito: 100 Bs por dólar y 200 por
// euro. Con tasas reales —38,2 y 44,7— cada fila habría que comprobarla con
// una calculadora, y una prueba cuyo valor esperado hay que calcular aparte
// es una prueba que se escribe mirando el resultado.
{
  const TASA = { USD: 100, EUR: 200 };
  const aBolivares = (monto, moneda) => (moneda == null ? null : monto * TASA[moneda]);
  const desdeBolivares = (bs, moneda) => (moneda == null ? null : bs / TASA[moneda]);

  const conMoneda = (id, currency, opciones) => ({ ...fiado(id, opciones), currency });

  // Dos libros. El de euros está MÁS VENCIDO, así que la gravedad lo pone
  // primero aunque sea el de la otra moneda — que es el punto entero.
  const dosLibros = [
    conMoneda("usd", "USD", { pendiente: 10, dias: 5, plazo: 30 }),
    conMoneda("eur", "EUR", { pendiente: 10, dias: 60, plazo: 30 }),
  ];

  {
    // 1.000 Bs = 5 euros. El de euros debe 10 EUR = 2.000 Bs, así que se lo
    // lleva todo y al de dólares no le llega nada.
    const r = repartirEnBolivares({
      montoBs: 1000,
      fiados: dosLibros,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    const porId = new Map(r.lineas.map((l) => [l.movementId, l]));
    check(
      "el billete cae primero en el fiado MÁS GRAVE, aunque sea de otro libro",
      porId.get("eur").asignado === 5 && porId.get("usd").asignado === 0,
      `euros ${porId.get("eur").asignado} · dólares ${porId.get("usd").asignado}`,
    );
    check(
      "y la línea queda en la moneda de SU fiado, no en bolívares",
      porId.get("eur").currency === "EUR" && porId.get("eur").asignadoBs === 1000,
      `${porId.get("eur").asignado} ${porId.get("eur").currency} · ${porId.get("eur").asignadoBs} Bs`,
    );
  }

  {
    // 3.000 Bs: 2.000 saldan el fiado en euros (10 EUR) y los 1.000 que
    // sobran bajan al de dólares (10 USD). Un reparto MIXTO, que es lo que la
    // `141` hizo posible.
    const r = repartirEnBolivares({
      montoBs: 3000,
      fiados: dosLibros,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    const porId = new Map(r.lineas.map((l) => [l.movementId, l]));
    check(
      "lo que sobra del primero CRUZA al otro libro",
      porId.get("eur").asignado === 10 && porId.get("usd").asignado === 10,
      `euros ${porId.get("eur").asignado} · dólares ${porId.get("usd").asignado}`,
    );
    check(
      "y el billete se gasta entero, sin sobrante",
      r.repartidoBs === 3000 && r.sinAsignarBs === 0,
      `repartido ${r.repartidoBs} Bs · sin asignar ${r.sinAsignarBs} Bs`,
    );
  }

  {
    // MÁS DINERO QUE DEUDA. Los dos fiados suman 3.000 Bs; con 5.000 sobran
    // 2.000, y ninguna línea puede pasarse de lo suyo.
    const r = repartirEnBolivares({
      montoBs: 5000,
      fiados: dosLibros,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    check(
      "nunca le mete a un fiado más de lo que debe, y lo que sobra se dice",
      r.lineas.every((l) => l.asignado <= 10.005) && r.sinAsignarBs === 2000,
      `sobran ${r.sinAsignarBs} Bs · líneas ${r.lineas.map((l) => l.asignado).join(", ")}`,
    );
  }

  {
    // LO FIJADO A MANO VIENE EN LA MONEDA DE SU FIADO, no en bolívares: es lo
    // que el tendero tecleó en la pantalla de ese fiado. Aquí le fija 3 USD al
    // de dólares, que son 300 Bs, y al de euros le quedan 700 Bs = 3,5 EUR.
    const r = repartirEnBolivares({
      montoBs: 1000,
      fiados: dosLibros,
      aMano: { usd: 3 },
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    const porId = new Map(r.lineas.map((l) => [l.movementId, l]));
    check(
      "lo fijado a mano se respeta en SU moneda y el resto baja por gravedad",
      porId.get("usd").asignado === 3 &&
        porId.get("usd").aMano === true &&
        porId.get("eur").asignado === 3.5,
      `dólares ${porId.get("usd").asignado} · euros ${porId.get("eur").asignado}`,
    );
  }

  {
    // UN FIADO SIN TASA no entra, ni rompe el reparto de los demás. `null` es
    // el libro colombiano, que aquí no debería llegar nunca — y si llega, lo
    // que no puede hacer es colarse con una cifra inventada.
    const conHuerfano = [
      ...dosLibros,
      conMoneda("sinTasa", null, { pendiente: 10, dias: 90, plazo: 30 }),
    ];
    const r = repartirEnBolivares({
      montoBs: 1000,
      fiados: conHuerfano,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    const porId = new Map(r.lineas.map((l) => [l.movementId, l]));
    check(
      "un fiado cuya moneda no se puede convertir recibe 0, y los demás siguen",
      porId.get("sinTasa").asignado === 0 && porId.get("eur").asignado === 5,
      `sin tasa ${porId.get("sinTasa").asignado} · euros ${porId.get("eur").asignado}`,
    );
  }

  {
    // EL TOPE QUE LA PANTALLA ENSEÑA Y EL QUE EL REPARTO USA SALEN DE LA MISMA
    // LISTA. Si no, la pantalla aceptaría una cifra que luego no cabe.
    const conHuerfano = [
      ...dosLibros,
      conMoneda("sinTasa", null, { pendiente: 10, dias: 90, plazo: 30 }),
    ];
    const tope = deudaEnBolivares(conHuerfano, aBolivares);
    const r = repartirEnBolivares({
      montoBs: tope,
      fiados: conHuerfano,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    check(
      "tecleando el tope exacto no sobra nada: el tope ignora lo mismo que el reparto",
      tope === 3000 && r.sinAsignarBs === 0,
      `tope ${tope} Bs · sin asignar ${r.sinAsignarBs} Bs`,
    );
  }

  {
    // UN SOLO LIBRO: tiene que dar lo mismo que `repartir`, que es la función
    // que lleva veinte filas probadas. Si las dos se separan, esta fila lo
    // dice antes de que lo diga un tendero.
    const soloUsd = [
      conMoneda("a", "USD", { pendiente: 10, dias: 60, plazo: 30 }),
      conMoneda("b", "USD", { pendiente: 10, dias: 5, plazo: 30 }),
    ];
    const multi = repartirEnBolivares({
      montoBs: 1500,
      fiados: soloUsd,
      ahora: AHORA,
      aBolivares,
      desdeBolivares,
    });
    const simple = repartir({ monto: 15, fiados: soloUsd, ahora: AHORA });
    check(
      "con un solo libro da lo mismo que `repartir`",
      multi.lineas.map((l) => l.asignado).join() === simple.lineas.map((l) => l.asignado).join(),
      `multi ${multi.lineas.map((l) => l.asignado).join(", ")} · simple ${simple.lineas.map((l) => l.asignado).join(", ")}`,
    );
  }
}

// ── 7. LA UNIDAD DEL REPARTO, QUE ES LO QUE SE GUARDÓ MAL ────────────────
//
// Esto es la regresión del 2026-10-29, medida en PRODUCCIÓN: un abono de
// Bs. 10.000 repartido a mano entre dos fiados en dólares se guardó como
// $0,01 y el saldo del cliente bajó un céntimo. La pantalla dijo
// «registrado con éxito» y no hubo ni un error.
//
// Y ESTO ES LO QUE NO LO CAZÓ, que es la mitad que importa: `qa:abono-accion`
// prueba la acción del servidor, que hizo exactamente lo que se le pidió;
// esta misma suite probaba la aritmética, que también estaba bien. El fallo
// vivía en la línea que une las dos, dentro de un `.tsx` que ninguna suite
// monta. Por eso la decisión salió del componente a `resolveSplitUnits` — no
// por elegancia: para que exista algo que se pueda poner en rojo.
{
  const caso = (enBolivares, numeroDeLibros, porLinea) =>
    resolveSplitUnits({ enBolivares, numeroDeLibros, porLinea });

  // EL CASO ROTO. Bolívares, un solo libro, y el total fijado fiado por fiado.
  const roto = caso(true, 1, true);
  check(
    "bolívares + un libro + por línea: el total va en bolívares",
    roto.totalInBolivars === true,
    `totalInBolivars=${roto.totalInBolivars}`,
  );
  check(
    "y se cuenta cruzando libros, que es la aritmética que suma en bolívares",
    roto.crossesLedgers === true,
    `crossesLedgers=${roto.crossesLedgers}`,
  );

  // LO QUE NO SE PUEDE ROMPER AL ARREGLARLO: el camino del campo con un solo
  // libro sigue sin cruzar. Lo dice el comentario de `abono-reparto.tsx` del
  // 2026-10-23 y se midió correcto en producción el 2026-10-29 —Bs. 5.000 se
  // guardaron como $5,62 con «Bs. 5.000,00» intacto en la fila.
  const campoUnLibro = caso(true, 1, false);
  check(
    "bolívares + un libro + monto en el campo: NO cruza libros",
    campoUnLibro.crossesLedgers === false,
    `crossesLedgers=${campoUnLibro.crossesLedgers}`,
  );
  check(
    "pero su total SÍ va en bolívares: el campo ya es bolívares",
    campoUnLibro.totalInBolivars === true,
  );

  // Dos libros: cruza siempre, se teclee donde se teclee. Encargo del dueño
  // del 2026-10-23.
  check("bolívares + dos libros + campo: cruza", caso(true, 2, false).crossesLedgers === true);
  check("bolívares + dos libros + por línea: cruza", caso(true, 2, true).crossesLedgers === true);

  // Sin bolívares no se cruza nunca y el total va en el libro. Con euros no se
  // paga una deuda en dólares: decisión del 2026-10-22, que la del 2026-10-23
  // no cambió.
  for (const libros of [1, 2]) {
    for (const porLinea of [false, true]) {
      const r = caso(false, libros, porLinea);
      check(
        `sin bolívares (${libros} libro(s), ${porLinea ? "por línea" : "campo"}): ni cruza ni va en Bs`,
        r.crossesLedgers === false && r.totalInBolivars === false,
      );
    }
  }

  // LA INVARIANTE, y es la que de verdad vigila esto: contar en bolívares y
  // etiquetar en bolívares son la misma respuesta. El fallo fue exactamente
  // que dejaron de serlo — se cruzaba en una unidad y se etiquetaba en otra.
  let incoherentes = 0;
  for (const enBolivares of [false, true]) {
    for (const libros of [1, 2, 3]) {
      for (const porLinea of [false, true]) {
        const r = caso(enBolivares, libros, porLinea);
        if (r.crossesLedgers && !r.totalInBolivars) incoherentes++;
      }
    }
  }
  check(
    "nunca se cruza en bolívares con un total etiquetado en otra moneda",
    incoherentes === 0,
    `${incoherentes} combinación(es) incoherentes`,
  );
}

// ── 8. LO TECLEADO EN BOLÍVARES ES EL TOPE DE SU LÍNEA (R-1.2) ───────────
//
// Encontrado en la regresión del 2026-10-30. Un reparto a mano en bolívares
// topaba cada línea con `aBolivares(aMano)`, y `aMano` es lo tecleado pasado al
// libro y redondeado al céntimo. Cuando ese redondeo iba hacia abajo —Bs 6.000
// a 992,80 son €6,0435 → €6,04 → Bs 5.996,51— sobraban bolívares sin asignar y
// la acción rechazaba el abono entero. Pasaba en el 52 % de las combinaciones
// de un barrido de dos fiados, así que no era un borde: era la mitad del uso.
//
// LA FILA 9 DE `qa:abono-accion` NO LO VEÍA porque su ejemplo, en dólares,
// redondeaba hacia arriba. Por eso aquí va el caso en euros que lo destapó Y
// un barrido entero: una fila suelta acierta o falla por la suerte del
// redondeo; el barrido no.
{
  const r2 = (x) => Math.round(x * 100) / 100;
  const fiadosDe = (moneda, a = 13, b = 19.5) => [
    { movementId: "A", createdAt: "2026-10-25T00:00:00Z", plazoDias: 15, cuotas: null, amount: a, pendiente: a, currency: moneda },
    { movementId: "B", createdAt: "2026-10-28T00:00:00Z", plazoDias: 15, cuotas: null, amount: b, pendiente: b, currency: moneda },
  ];
  const conTasa = (t) => ({ aBolivares: (m) => r2(m * t), desdeBolivares: (bs) => r2(bs / t) });

  {
    const t = 992.80018713;
    const r = repartirEnBolivares({
      montoBs: 10000,
      fiados: fiadosDe("EUR"),
      aMano: { A: r2(4000 / t), B: r2(6000 / t) },
      aManoBs: { A: 4000, B: 6000 },
      ...conTasa(t),
    });
    check(
      "8a. euros, Bs 4.000 + 6.000 a mano: no sobra ni un bolívar",
      r.sinAsignarBs <= 0.005,
      `sin asignar Bs ${r.sinAsignarBs}`,
    );
    const a = r.lineas.find((l) => l.movementId === "A");
    const b = r.lineas.find((l) => l.movementId === "B");
    check(
      "8b. y cada línea guarda lo que la pantalla enseñó: €4,03 y €6,04",
      a?.asignado === 4.03 && b?.asignado === 6.04 && a?.asignadoBs === 4000 && b?.asignadoBs === 6000,
      `A ${a?.asignado}/${a?.asignadoBs} · B ${b?.asignado}/${b?.asignadoBs}`,
    );
  }

  {
    // EL BARRIDO: dos fiados de $20, Bs 500 a 9.000 en cada uno, de 250 en 250.
    // Antes del arreglo: 636 rechazos de 1.225.
    const t = 889.2553;
    let rechaza = 0;
    let total = 0;
    for (let a = 500; a <= 9000; a += 250) {
      for (let b = 500; b <= 9000; b += 250) {
        total++;
        const r = repartirEnBolivares({
          montoBs: a + b,
          fiados: fiadosDe("USD", 20, 20),
          aMano: { A: r2(a / t), B: r2(b / t) },
          aManoBs: { A: a, B: b },
          ...conTasa(t),
        });
        if (r.sinAsignarBs > 0.005) rechaza++;
      }
    }
    check("8c. barrido de 1.225 repartos a mano en Bs: ninguno deja bolívares sin asignar", rechaza === 0, `${rechaza} de ${total}`);
  }

  {
    // UN BOLÍVAR VIEJO NO MANDA. Si el tendero fijó Bs 4.000 y luego cambió la
    // línea a €3 a mano, esos Bs 4.000 ya no describen la línea: se ignoran y
    // la línea toma sus €3, como antes del arreglo.
    const t = 992.80018713;
    const r = repartirEnBolivares({
      montoBs: r2(3 * t),
      fiados: fiadosDe("EUR"),
      aMano: { A: 3 },
      aManoBs: { A: 4000 },
      ...conTasa(t),
    });
    const a = r.lineas.find((l) => l.movementId === "A");
    check(
      "8d. unos bolívares que ya no corresponden a la cifra fijada se ignoran",
      a?.asignado === 3 && Math.abs(a.asignadoBs - r2(3 * t)) < 0.01,
      `A €${a?.asignado} · Bs ${a?.asignadoBs}`,
    );
  }

  {
    // EL MISMO FALLO CRUZANDO LIBROS, que es la variante que YA estaba en
    // producción antes de este arreglo: un fiado en dólares y otro en euros,
    // cada uno con sus bolívares tecleados.
    const tUsd = 889.2553;
    const tEur = 992.80018713;
    let rechaza = 0;
    let total = 0;
    for (let a = 500; a <= 9000; a += 500) {
      for (let b = 500; b <= 9000; b += 500) {
        total++;
        const r = repartirEnBolivares({
          montoBs: a + b,
          fiados: [
            { movementId: "U", createdAt: "2026-10-25T00:00:00Z", plazoDias: 15, cuotas: null, amount: 20, pendiente: 20, currency: "USD" },
            { movementId: "E", createdAt: "2026-10-28T00:00:00Z", plazoDias: 15, cuotas: null, amount: 20, pendiente: 20, currency: "EUR" },
          ],
          aMano: { U: r2(a / tUsd), E: r2(b / tEur) },
          aManoBs: { U: a, E: b },
          aBolivares: (m, c) => r2(m * (c === "USD" ? tUsd : tEur)),
          desdeBolivares: (bs, c) => r2(bs / (c === "USD" ? tUsd : tEur)),
        });
        if (r.sinAsignarBs > 0.005) rechaza++;
      }
    }
    check("8f. a mano cruzando dólares y euros: ninguno deja bolívares sin asignar", rechaza === 0, `${rechaza} de ${total}`);
  }

  {
    // SIN BOLÍVARES TECLEADOS, IGUAL QUE SIEMPRE: el arreglo no toca el
    // reparto que no los trae.
    const t = 889.2553;
    const sin = repartirEnBolivares({ montoBs: 9000, fiados: fiadosDe("USD", 20, 20), ...conTasa(t) });
    const conVacio = repartirEnBolivares({ montoBs: 9000, fiados: fiadosDe("USD", 20, 20), aManoBs: {}, ...conTasa(t) });
    check(
      "8e. sin bolívares por línea el reparto automático no cambia",
      JSON.stringify(sin) === JSON.stringify(conVacio),
    );
  }
}

// ── 9. MANDA EL BILLETE, NO LA SUMA DE SUS LÍNEAS ─────────────────────────
//
// Owner's decision of 2026-10-30 («Manda el billete»), after production abono
// HDXR320: Bs. 10.000 split by hand as 5.000 + 5.000 between two dollar fiados
// stored $5,62 + $5,62 = $11,24, while the same note split automatically
// stored $11,25. Within one ledger the lines now add up to the conversion of
// their bolivars together, and the last line with room absorbs the cent. The
// bolivars per line never change: they are what the shopkeeper typed.
{
  const r2 = (x) => Math.round(x * 100) / 100;
  const fiadosDe = (moneda, a, b) => [
    { movementId: "A", createdAt: "2026-10-25T00:00:00Z", plazoDias: 15, cuotas: null, amount: a, pendiente: a, currency: moneda },
    { movementId: "B", createdAt: "2026-10-28T00:00:00Z", plazoDias: 15, cuotas: null, amount: b, pendiente: b, currency: moneda },
  ];
  const conTasa = (t) => ({ aBolivares: (m) => r2(m * t), desdeBolivares: (bs) => r2(bs / t) });
  const suma = (lineas) => r2(lineas.reduce((acc, l) => acc + l.asignado, 0));
  const tUsd = 889.2553;
  const tEur = 992.80018713;

  {
    // THE PRODUCTION CASE, with that day's fiados: Libro $7,37 and Camiseta $19,50.
    const r = repartirEnBolivares({
      montoBs: 10000,
      fiados: fiadosDe("USD", 7.37, 19.5),
      aMano: { A: r2(5000 / tUsd), B: r2(5000 / tUsd) },
      aManoBs: { A: 5000, B: 5000 },
      ahora: AHORA,
      ...conTasa(tUsd),
    });
    const a = r.lineas.find((l) => l.movementId === "A");
    const b = r.lineas.find((l) => l.movementId === "B");
    check(
      "9a. Bs 5.000 + 5.000 a mano en dólares: se guarda $11,25 (el billete), no $11,24",
      suma(r.lineas) === r2(10000 / tUsd) && suma(r.lineas) === 11.25,
      `A ${a?.asignado} · B ${b?.asignado} · total ${suma(r.lineas)}`,
    );
    check(
      "9b. y los bolívares de cada línea siguen siendo los tecleados",
      a?.asignadoBs === 5000 && b?.asignadoBs === 5000 && r.sinAsignarBs <= 0.005,
      `A Bs ${a?.asignadoBs} · B Bs ${b?.asignadoBs}`,
    );
  }

  {
    // THE SWEEP, bolivar state: every combination adds up to the note, no line
    // goes over what its fiado owes, and no line moves more than one cent.
    let malos = 0;
    let total = 0;
    for (let a = 500; a <= 9000; a += 250) {
      for (let b = 500; b <= 9000; b += 250) {
        total++;
        const r = repartirEnBolivares({
          montoBs: a + b,
          fiados: fiadosDe("USD", 20, 20),
          aMano: { A: r2(a / tUsd), B: r2(b / tUsd) },
          aManoBs: { A: a, B: b },
          ahora: AHORA,
          ...conTasa(tUsd),
        });
        const la = r.lineas.find((l) => l.movementId === "A");
        const lb = r.lineas.find((l) => l.movementId === "B");
        const ok =
          suma(r.lineas) === r2((a + b) / tUsd) &&
          la.asignado <= 20 && lb.asignado <= 20 &&
          Math.abs(la.asignado - r2(a / tUsd)) <= 0.0101 &&
          Math.abs(lb.asignado - r2(b / tUsd)) <= 0.0101 &&
          la.asignadoBs === a && lb.asignadoBs === b &&
          r.sinAsignarBs <= 0.005;
        if (!ok) malos++;
      }
    }
    check("9c. barrido de 1.225 repartos en Bs: todos suman el billete, sin pasarse ni mover más de un céntimo", malos === 0, `${malos} de ${total}`);
  }

  {
    // A LINE AT ITS CAP DOES NOT TAKE THE CENT: the other one does. B owes
    // exactly what its bolivars buy ($5,62), so the +0,01 goes to A.
    const r = repartirEnBolivares({
      montoBs: 10000,
      fiados: fiadosDe("USD", 20, 5.62),
      aMano: { A: 5.62, B: 5.62 },
      aManoBs: { A: 5000, B: 5000 },
      ahora: AHORA,
      ...conTasa(tUsd),
    });
    const a = r.lineas.find((l) => l.movementId === "A");
    const b = r.lineas.find((l) => l.movementId === "B");
    check("9d. la línea al tope no se pasa: el céntimo cae en la otra", b?.asignado === 5.62 && a?.asignado === 5.63, `A ${a?.asignado} · B ${b?.asignado}`);
  }

  {
    // A LINE CUT DOWN BY ITS PENDIENTE IS LEFT OUT: its bolivars describe more
    // than it holds, and counting them would move real money, not a cent.
    const out = absorbLedgerCents(
      [
        { movementId: "A", asignado: 3, bs: 5000, pendiente: 3 },
        { movementId: "B", asignado: 5.62, bs: 5000, pendiente: 20 },
      ],
      (bs) => bs / tUsd,
    );
    check("9e. una línea recortada no le pasa dinero a la otra", out.get("A") === 3 && out.get("B") === 5.62, `A ${out.get("A")} · B ${out.get("B")}`);
  }

  {
    // THE ONE-LEDGER STATE, the euro case of the same day: Bs 5.000 + 5.000
    // into euros is €5,04 + €5,04 = €10,08 line by line, €10,07 as a note.
    const adj = absorbPinnedCents({
      fiados: fiadosDe("EUR", 20, 20),
      aMano: { A: r2(5000 / tEur), B: r2(5000 / tEur) },
      aManoBs: { A: 5000, B: 5000 },
      ahora: AHORA,
      fromBolivars: (bs) => bs / tEur,
    });
    const total = r2(adj.A + adj.B);
    check("9f. un libro, euros: las líneas fijadas en Bs suman €10,07, no €10,08", total === r2(10000 / tEur) && total === 10.07, `A ${adj.A} · B ${adj.B}`);
    // And `repartir` places them exactly, so the server's whole-line check
    // (stored amount == adjusted pin) recognises both as typed in bolivars.
    const r = repartir({ monto: total, fiados: fiadosDe("EUR", 20, 20), aMano: adj, ahora: AHORA });
    check(
      "9g. y repartir las coloca tal cual: ninguna línea pierde su cifra tecleada",
      r.lineas.every((l) => l.asignado === adj[l.movementId]) && r.sinAsignar <= 0.005,
      r.lineas.map((l) => `${l.movementId} ${l.asignado}`).join(" · "),
    );
  }

  {
    // THE SWEEP, one-ledger state.
    let malos = 0;
    let total = 0;
    for (let a = 500; a <= 9000; a += 250) {
      for (let b = 500; b <= 9000; b += 250) {
        total++;
        const aMano = { A: r2(a / tEur), B: r2(b / tEur) };
        const adj = absorbPinnedCents({
          fiados: fiadosDe("EUR", 20, 20),
          aMano,
          aManoBs: { A: a, B: b },
          ahora: AHORA,
          fromBolivars: (bs) => bs / tEur,
        });
        const r = repartir({ monto: r2(adj.A + adj.B), fiados: fiadosDe("EUR", 20, 20), aMano: adj, ahora: AHORA });
        const ok =
          r2(adj.A + adj.B) === r2((a + b) / tEur) &&
          Math.abs(adj.A - aMano.A) <= 0.0101 && Math.abs(adj.B - aMano.B) <= 0.0101 &&
          r.lineas.every((l) => l.asignado === adj[l.movementId]) && r.sinAsignar <= 0.005;
        if (!ok) malos++;
      }
    }
    check("9h. barrido de 1.225 en un libro: todos suman el billete y se colocan tal cual", malos === 0, `${malos} de ${total}`);
  }

  {
    // WITHOUT TYPED BOLIVARS NOTHING MOVES: pins in the ledger's own currency
    // are his figures, not conversions.
    const adj = absorbPinnedCents({ fiados: fiadosDe("EUR", 20, 20), aMano: { A: 5.04, B: 5.04 }, aManoBs: {}, ahora: AHORA, fromBolivars: (bs) => bs / tEur });
    check("9i. sin bolívares tecleados lo fijado no cambia", adj.A === 5.04 && adj.B === 5.04);
  }
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
