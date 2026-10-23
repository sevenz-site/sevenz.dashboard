// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. NO ESCRIBE NADA.
//
// ===========================================================================
// LA INVARIANTE: EL PUNTAJE Y LA BASE REPARTEN EL MISMO DINERO IGUAL
//
// La misma ficha del cliente enseña dos cosas que salen de dos sitios:
//
//   · el saldo, el chip de «plazo vencido» y el fiado que señala como más
//     grave los calcula POSTGRES, en `get_open_charges_for_client`;
//   · la «Puntualidad histórica» del puntaje la calcula TYPESCRIPT, en
//     `buildChargeLedger`.
//
// Las dos tienen que repartir cada abono entre los fiados de la misma forma.
// Si no, la ficha se contradice consigo misma: puede decir que un fiado sigue
// debiéndose entero y, dos centímetros más abajo, contarlo como «pagado a
// tiempo».
//
// ===========================================================================
// QUÉ LO ROMPIÓ, QUE ES POR LO QUE ESTO EXISTE (CT-124)
//
// La migración `126` le enseñó a Postgres a respetar la DIRECCIÓN de un abono
// —el fiado que el tendero eligió— y `buildChargeLedger` siguió repartiendo
// por antigüedad, porque su tipo de entrada ni recibía
// `applies_to_movement_id`.
//
// Medido en dev el 2026-10-21, con dos fiados de $50: uno con plazo de 60 días
// (sin vencer) y otro con plazo de 7 (vencido hace 23). El cliente abona $50 y
// los dirige al vencido. La base dice que sigue debiendo el primero; el puntaje
// decía «1 de 2 cargos pagados a tiempo» — le apuntaba un pago puntual a un
// fiado que nadie había pagado, y le perdonaba el retraso del que sí pagó
// tarde.
//
// Y con ello había una segunda diferencia que nadie había escrito: Postgres
// lleva UN LIBRO POR MONEDA (`currency is not distinct from`), y el de
// TypeScript metía dólares y euros en la misma cola. Un abono en euros podía
// cerrar un fiado en dólares por ser el más viejo.
//
// ===========================================================================
// POR QUÉ ESTA SUITE Y NO UNA PRUEBA DE LA FUNCIÓN SOLA
//
// Porque lo que importa no es que `buildChargeLedger` haga lo que su autor
// pensó: es que haga lo MISMO que la base. Una prueba escrita contra la idea
// pasa en verde mientras las dos mitades se separan — que es exactamente lo
// que pasó durante los cuatro días que la `126` llevaba corrida.
//
// Es la regla de `CLAUDE.md`: al menos un control tiene que mirar la realidad
// exterior. Aquí la realidad exterior es Postgres.
//
// LO QUE RECORRE, Y POR QUÉ LOS DOS:
//
//   1. TODOS los clientes de dev que tengan algún abono dirigido. Son datos
//      reales, escritos por el flujo de verdad, con sus casos raros incluidos.
//   2. Un caso MONTADO —el de `CT-124`, dos plazos distintos— porque los datos
//      de dev pueden dejar de tener abonos dirigidos cualquier día y una suite
//      que entonces pase en verde sin comparar nada es peor que no tenerla.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { buildChargeLedger } from "../lib/credit-score.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

const HOLGURA = 0.005;
const MARCA = "QA PUNTAJE CT-124";
const creados = [];

// Las dos caras de la comparación, para un cliente.
//
// NO se le pasan los movimientos convertidos a dólares, y es a propósito: un
// libro por moneda ya separa lo que la conversión intentaba separar, y
// convertir mete decimales que no existen en la base. Un fiado de 3 € pagado
// con tres abonos de 1 € quedaba en 0,01 y no cerraba nunca.
async function comparar(clientId) {
  const { data: movs, error: eMovs } = await admin
    .from("movements")
    .select("id, type, amount, currency, created_at, plazo_dias, applies_to_movement_id")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (eMovs) throw new Error(`movements: ${eMovs.message}`);

  const { data: abiertos, error: eRpc } = await admin.rpc("get_open_charges_for_client", {
    p_client_id: clientId,
  });
  if (eRpc) throw new Error(`get_open_charges_for_client: ${eRpc.message}`);

  const base = new Map((abiertos ?? []).map((r) => [r.movement_id, Number(r.pending)]));
  const ts = new Map(
    buildChargeLedger(movs ?? [])
      .filter((c) => c.remaining > HOLGURA)
      .map((c) => [c.movementId, c.remaining]),
  );

  const diffs = [];
  for (const id of new Set([...base.keys(), ...ts.keys()])) {
    const b = base.get(id) ?? 0;
    const t = ts.get(id) ?? 0;
    if (Math.abs(b - t) > HOLGURA) diffs.push({ id, base: b, ts: t });
  }
  return { diffs, cargosAbiertos: base.size };
}

try {
  // ── 1. LOS CLIENTES REALES DE DEV ──────────────────────────────────────
  const { data: conDireccion } = await admin
    .from("movements")
    .select("client_id")
    .not("applies_to_movement_id", "is", null)
    .is("deleted_at", null);
  const clientes = [...new Set((conDireccion ?? []).map((r) => r.client_id))];

  if (clientes.length === 0) {
    check(
      "hay clientes con abonos dirigidos que comparar",
      false,
      "cero en dev — la fila de abajo es la unica que compara algo",
    );
  } else {
    const malos = [];
    let cargos = 0;
    for (const id of clientes) {
      const { diffs, cargosAbiertos } = await comparar(id);
      cargos += cargosAbiertos;
      if (diffs.length > 0) malos.push({ id, diffs });
    }
    check(
      `el puntaje reparte igual que la base en los ${clientes.length} clientes con abonos dirigidos (${cargos} fiados abiertos)`,
      malos.length === 0,
      malos.length === 0
        ? "coinciden fiado a fiado"
        : malos
            .slice(0, 4)
            .map(
              (m) =>
                `cliente ${m.id.slice(0, 8)}: ` +
                m.diffs
                  .slice(0, 3)
                  .map((d) => `fiado ${d.id.slice(0, 8)} base=${d.base} puntaje=${d.ts}`)
                  .join(", "),
            )
            .join(" · "),
    );
  }

  // ── 2. EL CASO DE CT-124, MONTADO ──────────────────────────────────────
  //
  // Dos fiados iguales en dinero y distintos en plazo. El abono salda el
  // VENCIDO. Lo que se comprueba no es solo que las dos mitades coincidan:
  // es que el fiado que queda abierto sea el que de verdad quedó abierto.
  const { data: ve } = await admin
    .from("owners")
    .select("id")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

  const { data: cli } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  creados.push(cli.id);

  const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const cargo = async (monto, dias, plazo) =>
    (
      await admin
        .from("movements")
        .insert({
          client_id: cli.id,
          created_by: ve.id,
          type: "charge",
          amount: monto,
          currency: "USD",
          plazo_dias: plazo,
          created_at: hace(dias),
        })
        .select("id")
        .single()
    ).data.id;

  // El de 60 días nacio hace 30: aun le quedan 30 de plazo.
  const sinVencer = await cargo(50, 30, 60);
  // El de 7 dias nacio hace 30: vencido hace 23.
  const vencido = await cargo(50, 30, 7);

  await admin.from("movements").insert({
    client_id: cli.id,
    created_by: ve.id,
    type: "payment",
    amount: 50,
    currency: "USD",
    created_at: hace(1),
    applies_to_movement_id: vencido,
  });

  const { diffs } = await comparar(cli.id);
  check(
    "el caso de CT-124: el abono dirigido al fiado VENCIDO",
    diffs.length === 0,
    diffs.length === 0
      ? "las dos mitades dejan abierto el mismo fiado"
      : diffs.map((d) => `fiado ${d.id.slice(0, 8)} base=${d.base} puntaje=${d.ts}`).join(", "),
  );

  const ledger = buildChargeLedger(
    (
      await admin
        .from("movements")
        .select("id, type, amount, currency, created_at, plazo_dias, applies_to_movement_id")
        .eq("client_id", cli.id)
        .is("deleted_at", null)
    ).data,
  );
  const elVencido = ledger.find((c) => c.movementId === vencido);
  const elOtro = ledger.find((c) => c.movementId === sinVencer);
  check(
    "y el que el puntaje cuenta como cerrado es el vencido, no el otro",
    elVencido?.closedAt != null && elOtro?.closedAt == null,
    `vencido cerrado=${elVencido?.closedAt != null} · sin vencer cerrado=${elOtro?.closedAt != null}`,
  );

  // ── 3. UN LIBRO POR MONEDA ─────────────────────────────────────────────
  //
  // Un fiado en euros MÁS VIEJO que uno en dólares, y un abono en dólares sin
  // dirigir. Postgres no puede tocar el de euros; la cola única de TypeScript
  // sí lo hacía, por ser el más antiguo.
  const { data: cli2 } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} dos libros` })
    .select("id")
    .single();
  creados.push(cli2.id);

  const enMoneda = async (monto, dias, moneda) =>
    (
      await admin
        .from("movements")
        .insert({
          client_id: cli2.id,
          created_by: ve.id,
          type: "charge",
          amount: monto,
          currency: moneda,
          plazo_dias: 15,
          created_at: hace(dias),
        })
        .select("id")
        .single()
    ).data.id;

  const euro = await enMoneda(20, 40, "EUR");
  const dolar = await enMoneda(20, 10, "USD");
  await admin.from("movements").insert({
    client_id: cli2.id,
    created_by: ve.id,
    type: "payment",
    amount: 20,
    currency: "USD",
    created_at: hace(1),
  });

  const { diffs: d2 } = await comparar(cli2.id);
  check(
    "un abono en dolares NO puede cerrar un fiado en euros, aunque sea mas viejo",
    d2.length === 0,
    d2.length === 0
      ? `el de euros (${euro.slice(0, 8)}) sigue abierto en las dos mitades`
      : d2.map((x) => `fiado ${x.id.slice(0, 8)} base=${x.base} puntaje=${x.ts}`).join(", ") +
          ` · (euro=${euro.slice(0, 8)} dolar=${dolar.slice(0, 8)})`,
  );
  // ── 4. LA PUERTA DE /admin TAMBIÉN TRAE LA DIRECCIÓN ───────────────────
  //
  // El promedio de `/admin` no lee la tabla: lee `admin_credit_movements`, una
  // función `security definer` que existe para que las pantallas de admin no
  // necesiten permisos sobre las tablas. Hasta la migración `143` esa función
  // no devolvía `applies_to_movement_id`.
  //
  // POR QUÉ ESTO NO LO CAZABA NADA: `lib/admin/metrics.ts` convierte cada fila
  // al tipo `Movement`, que SÍ tiene el campo. Así que compila, en ejecución
  // llega `undefined`, todos los abonos caen en el reparto por antigüedad y el
  // promedio se queda con la respuesta vieja. Sin error, sin aviso. Un cast es
  // una promesa, y esa había dejado de ser verdad.
  {
    const { data, error } = await admin.rpc("admin_credit_movements", {
      p_country: null,
      p_owners: null,
      p_from: null,
      p_to: null,
    });
    const filas = Array.isArray(data) ? data : [];
    const tieneCampo = filas.length > 0 && "applies_to_movement_id" in filas[0];
    check(
      "admin_credit_movements devuelve la direccion del abono (migracion 143)",
      !error && tieneCampo,
      error
        ? error.message
        : filas.length === 0
          ? "la funcion no devolvio filas: no se puede saber"
          : tieneCampo
            ? `${filas.length} filas, con el campo`
            : "FALTA el campo — la 143 no esta corrida en esta base",
    );
  }

} finally {
  for (const id of creados) {
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  console.log("\nlimpieza: los clientes de prueba, borrados de dev");
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
