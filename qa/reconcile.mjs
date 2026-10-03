// No toca la base ni la red: `reconcile.ts` es lógica pura y se prueba sola.
//
// POR QUÉ EXISTE. `CT-19`: el aviso «no cuadra» comparaba un total escrito a
// mano EN UNA PÁGINA contra un saldo corrido que arrancaba en LO QUE EL CLIENTE
// YA DEBÍA EN SEVENZ. Solo son comparables si los dos arrancan del mismo sitio.
// Medido en dev el 2026-09-25: la misma foto importada en dólares marcaba sus
// tres líneas desviadas exactamente 54,94 —lo que ese cliente ya debía— y en
// euros cuadraba. El rojo mentía, y mentía de una forma que parecía un
// hallazgo.
//
// La prueba que lo caza es la de abajo: EL MISMO cliente, LA MISMA página, en
// dos monedas. Si el resultado depende de la moneda, la base está mal.
import { reconcileMovements, agruparPorCliente } from "../lib/reconcile.ts";

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

const mov = (client_name, type, amount, read_balance, currency = null, extra = {}) => ({
  client_name,
  date: null,
  type,
  amount,
  description: null,
  read_balance,
  confidence: "high",
  document_id: null,
  whatsapp: null,
  currency,
  ...extra,
});

const cliente = (over = {}) => ({
  id: "cli-1",
  name: "Juanito",
  balance: 0,
  balance_usd: 0,
  balance_eur: 0,
  document_id: "123",
  ...over,
});

// ── 1. EL CASO DE CT-19, palabra por palabra ────────────────────────────
//
// Juanito ya debe 54,94 en dólares y nada en euros. La página dice 10, 30, 60:
// tres fiados de 10, 20 y 30 que cuadran perfectamente ENTRE SÍ.
{
  const pagina = (c) => [
    mov("Juanito", "charge", 10, 10, c),
    mov("Juanito", "charge", 20, 30, c),
    mov("Juanito", "charge", 30, 60, c),
  ];
  const conDeuda = cliente({ balance_usd: 54.94 });

  const enUsd = reconcileMovements(pagina("USD"), [conDeuda]);
  const enEur = reconcileMovements(pagina("EUR"), [conDeuda]);

  check(
    "la misma página no cuadra distinto según la moneda",
    enUsd.map((f) => f.review_reason).join() === enEur.map((f) => f.review_reason).join(),
    `USD=[${enUsd.map((f) => f.review_reason)}] EUR=[${enEur.map((f) => f.review_reason)}]`,
  );
  check(
    "y ninguna línea se marca en rojo: la página cuadra consigo misma",
    enUsd.every((f) => f.review_reason !== "no_cuadra"),
    enUsd.map((f) => f.review_reason ?? "ok").join(", "),
  );
  check(
    "el saldo previo sigue siendo un DATO: computed_balance lo suma",
    enUsd[2].computed_balance === 114.94,
    `computed_balance=${enUsd[2].computed_balance} (54,94 + 60)`,
  );
  check(
    "y no contamina la comprobación: page_balance no lo suma",
    enUsd[2].page_balance === 60,
    `page_balance=${enUsd[2].page_balance}`,
  );
  check(
    "el primer total escrito es el que dedujo la base",
    enUsd[0].defines_base === true && enUsd[1].defines_base === false,
    `[${enUsd.map((f) => f.defines_base)}]`,
  );
}

// ── 2. Un desajuste DE VERDAD se sigue viendo ───────────────────────────
//
// Lo contrario del caso anterior: si la página no cuadra consigo misma, hay que
// decirlo. Una comprobación que ya no se equivoca pero tampoco acierta no vale.
{
  const pagina = [
    mov("Juanito", "charge", 10, 10, "USD"),
    mov("Juanito", "charge", 20, 30, "USD"),
    // Aquí el tendero sumó mal: 30 + 30 son 60, no 50.
    mov("Juanito", "charge", 30, 50, "USD"),
  ];
  const r = reconcileMovements(pagina, [cliente({ balance_usd: 54.94 })]);
  check(
    "un error de suma real SÍ se marca",
    r[2].review_reason === "no_cuadra",
    `reason=${r[2].review_reason}`,
  );
  check(
    "y trae las dos cifras que el dueño puede comparar",
    r[2].read_balance === 50 && r[2].page_balance === 60,
    `escrito=${r[2].read_balance} calculado=${r[2].page_balance}`,
  );
}

// ── 3. Un cliente NUEVO se comprueba desde el primer total ──────────────
{
  const pagina = [mov("Nadie", "charge", 10, 99, "USD")];
  const r = reconcileMovements(pagina, []);
  check(
    "cliente nuevo: el primer total SÍ se comprueba, la página arranca en cero",
    r[0].review_reason === "no_cuadra" && r[0].defines_base === false,
    `reason=${r[0].review_reason} defines_base=${r[0].defines_base}`,
  );
}

// ── 4. Saldo cero NO es lo mismo que no existir ─────────────────────────
//
// Un cliente que ya existe y debe 0 pudo quedar así después de pagar, y esta
// página puede continuar otra. La certeza viene de no existir, no de deber cero.
{
  const pagina = [mov("Juanito", "charge", 10, 99, "USD")];
  const r = reconcileMovements(pagina, [cliente({ balance_usd: 0 })]);
  check(
    "cliente existente con saldo 0: su primer total deduce la base, no se acusa",
    r[0].review_reason === null && r[0].defines_base === true,
    `reason=${r[0].review_reason} defines_base=${r[0].defines_base}`,
  );
}

// ── 5. Sin ningún total escrito: no se puede comprobar, y se dice ───────
{
  const pagina = [mov("Ana", "charge", 10, null), mov("Ana", "charge", 20, null)];
  const r = reconcileMovements(pagina, []);
  const g = agruparPorCliente(r, [], { esVE: false });
  check(
    "una página sin totales queda «sin verificar», no en rojo",
    g[0].libros[0].estado === "sin_verificar",
    `estado=${g[0].libros[0].estado}`,
  );
}

// ── 6. Un solo total y cliente existente: tampoco se puede ──────────────
{
  const pagina = [mov("Juanito", "charge", 10, 10, "USD"), mov("Juanito", "charge", 20, null, "USD")];
  const r = reconcileMovements(pagina, [cliente({ balance_usd: 54.94 })]);
  const g = agruparPorCliente(r, [cliente({ balance_usd: 54.94 })], { esVE: true });
  check(
    "cliente existente con UN solo total: «sin verificar», porque ese total se gastó en la base",
    g[0].libros[0].estado === "sin_verificar",
    `estado=${g[0].libros[0].estado}`,
  );
}

// ── 7. La vista por cliente: dos monedas no se suman ────────────────────
{
  const pagina = [
    mov("Juanito", "charge", 50, null, "USD"),
    mov("Juanito", "charge", 20, null, "EUR"),
  ];
  const c = cliente({ balance_usd: 54.94, balance_eur: 10 });
  const g = agruparPorCliente(reconcileMovements(pagina, [c]), [c], { esVE: true });
  check("un cliente, dos libros", g.length === 1 && g[0].libros.length === 2, `${g[0].libros.length} libros`);
  const usd = g[0].libros.find((l) => l.currency === "USD");
  const eur = g[0].libros.find((l) => l.currency === "EUR");
  check(
    "cada libro con su saldo previo y su final, sin mezclarse",
    usd.saldoPrevio === 54.94 && usd.saldoFinal === 104.94 && eur.saldoPrevio === 10 && eur.saldoFinal === 30,
    `USD ${usd.saldoPrevio}->${usd.saldoFinal} · EUR ${eur.saldoPrevio}->${eur.saldoFinal}`,
  );
  check(
    "el candidato de CT-22 se expone, pero NO se decide por el dueño",
    g[0].candidatos[0]?.id === "cli-1" && g[0].candidatos[0]?.document_id === "123",
    `candidatos=${g[0].candidatos.map((c) => c.name).join(", ")}`,
  );
}

// ── 8. Moneda sin asignar: solo es un problema para un dueño VE ─────────
{
  const pagina = [mov("Ana", "charge", 10, null, null)];
  const r = reconcileMovements(pagina, []);
  check(
    "dueño CO: `currency` null es lo correcto, no falta nada",
    agruparPorCliente(r, [], { esVE: false })[0].necesitaMoneda === false,
  );
  check(
    "dueño VE: `currency` null sí es una moneda por asignar",
    agruparPorCliente(r, [], { esVE: true })[0].necesitaMoneda === true,
  );
}

// ── 9. Dos filas del mismo cliente son UN cliente ───────────────────────
{
  const pagina = [mov("Ana", "charge", 10, null), mov("ana ", "payment", 4, null)];
  const g = agruparPorCliente(reconcileMovements(pagina, []), [], { esVE: false });
  check(
    "el nombre se normaliza: «Ana» y «ana » son la misma persona",
    g.length === 1 && g[0].movimientos === 2,
    `${g.length} clientes, ${g[0]?.movimientos} movimientos`,
  );
  check("y su libro suma el abono", g[0].libros[0].totalPagina === 6, `total=${g[0].libros[0].totalPagina}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
