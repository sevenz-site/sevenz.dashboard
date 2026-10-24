// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. NO ESCRIBE NADA.
//
// ===========================================================================
// LA ÚNICA INVARIANTE QUE NO PUEDE ROMPERSE NUNCA
//
// El saldo que la app enseña tiene que ser la suma de los movimientos vivos
// de ese cliente en esa moneda. Punto. Si eso deja de cumplirse, todo lo
// demás que el producto dice sobre dinero deja de significar nada.
//
// Y NO SE CUMPLE SOLO: `client_summary` es una VISTA que lee el
// `running_balance` de la ÚLTIMA fila viva de cada moneda. O sea que el saldo
// no se calcula al mirarlo — se arrastra fila a fila desde que se escribió la
// primera, y cualquier escritura que rompa esa cadena deja un número
// plausible y falso en la ficha del cliente, en Cartera y en el enlace que el
// cliente abre.
//
// ===========================================================================
// QUÉ LO ROMPIÓ, QUE ES POR LO QUE ESTO EXISTE
//
// Encontrado el 2026-10-23: un cliente con cuatro repartos sumaba 0,00 en
// dólares y la app enseñaba 1,14.
//
// `running_balance` lo pone un disparador BEFORE INSERT que busca la fila
// anterior con `order by created_at desc, id desc`. Dentro de una
// transacción, `now()` es el instante de la TRANSACCIÓN: las N líneas de un
// reparto comparten `created_at` y el desempate cae en `id`, que es un uuid
// aleatorio. De la tercera línea en adelante cada una encadena desde una
// hermana cualquiera. La migración `142` lo arregla llamando a
// `recalc_client_running_balance`.
//
// ===========================================================================
// POR QUÉ UNA SUITE APARTE Y NO UNA FILA MÁS EN `qa:abono-repartido`
//
// Porque el fallo no fue del reparto: fue de QUIEN ESCRIBE VARIOS MOVIMIENTOS
// EN UNA TRANSACCIÓN Y NO RECALCULA. Hoy los escritores así son dos —
// `import_libreta`, que sí recalcula desde la `075`, y `registrar_abono_
// repartido`, que no lo hacía— y mañana habrá un tercero. Una fila dentro de
// la suite del reparto habría vigilado el caso; esto vigila la REGLA.
//
// Es la misma diferencia que `CLAUDE.md` ya cuenta sobre las suites escritas
// mirándose entre sí: tres controles que comprueban lo que su autor pensó
// coinciden perfectamente y pueden estar los tres equivocados. Esto no
// comprueba una implementación, comprueba una igualdad.
//
// ===========================================================================
// POR QUÉ NO DA FALSOS POSITIVOS CON LOS DATOS DE PRUEBA, que era lo primero
// que había que descartar
//
// Las suites de `qa/` crean movimientos con fecha hacia atrás (`hace(60)`), y
// eso parece que debería romper la cadena. No la rompe mientras se inserten
// de más antiguo a más nuevo, que es como están escritas todas: cada fila
// encuentra como anterior a la que de verdad le precede.
//
// Medido antes de escribir esto: de los 264 saldos de dev, 263 cuadraban y el
// único que no era el del fallo real. Si algún día una suite inserta al revés
// y esta se pone roja por eso, la respuesta es arreglar la suite —o llamar a
// `recalc_client_running_balance`— no rebajar esta comprobación.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const HOLGURA = 0.005;

// ── LA SUMA DE VERDAD, movimiento a movimiento ──────────────────────────
const { data: movs, error: eMovs } = await admin
  .from("movements")
  .select("client_id, type, amount, currency, payment_group_id")
  .is("deleted_at", null);

if (eMovs) {
  check("se pueden leer los movimientos", false, eMovs.message);
  process.exit(1);
}

const sumaReal = new Map();
const conReparto = new Set();
for (const m of movs ?? []) {
  const clave = `${m.client_id}|${m.currency ?? "COP"}`;
  const delta = m.type === "charge" ? Number(m.amount) : -Number(m.amount);
  sumaReal.set(clave, (sumaReal.get(clave) ?? 0) + delta);
  if (m.payment_group_id) conReparto.add(m.client_id);
}

// ── LO QUE LA APP ENSEÑA ────────────────────────────────────────────────
//
// `client_summary` y no `movements.running_balance` a mano: lo que importa es
// lo que el tendero LEE, y eso sale de la vista. Si algún día la vista cambia
// de forma de calcular, esto lo mide igual.
const { data: resumen, error: eRes } = await admin
  .from("client_summary")
  .select("client_id, balance, balance_usd, balance_eur");

if (eRes) {
  check("se puede leer client_summary", false, eRes.message);
  process.exit(1);
}

const { data: clientes } = await admin.from("clients").select("id, name");
const nombreDe = new Map((clientes ?? []).map((c) => [c.id, c.name]));

const descuadres = [];
let comprobados = 0;

for (const r of resumen ?? []) {
  for (const [columna, moneda] of [
    ["balance", "COP"],
    ["balance_usd", "USD"],
    ["balance_eur", "EUR"],
  ]) {
    const enseñado = Number(r[columna] ?? 0);
    const real = Math.round((sumaReal.get(`${r.client_id}|${moneda}`) ?? 0) * 100) / 100;
    comprobados++;
    if (Math.abs(enseñado - real) > HOLGURA) {
      descuadres.push({
        cliente: nombreDe.get(r.client_id) ?? r.client_id.slice(0, 8),
        moneda,
        enseñado,
        real,
        tieneReparto: conReparto.has(r.client_id),
      });
    }
  }
}

check(
  `el saldo que la app enseña es la suma de los movimientos (${comprobados} saldos)`,
  descuadres.length === 0,
  descuadres.length === 0
    ? "todos cuadran"
    : descuadres
        .slice(0, 8)
        .map(
          (d) =>
            `${d.cliente} ${d.moneda}: enseña ${d.enseñado} y suma ${d.real}${d.tieneReparto ? " [tiene repartos]" : ""}`,
        )
        .join(" · "),
);

// ── LA PISTA, CUANDO FALLA ──────────────────────────────────────────────
//
// No es una comprobación: es lo que hay que leer antes de abrir el código. Si
// TODOS los descuadrados tienen repartos, el sospechoso es el escritor del
// reparto. Si hay descuadrados SIN repartos, el sospechoso es otro y conviene
// saberlo antes de perder media hora mirando el sitio equivocado.
if (descuadres.length > 0) {
  const sinReparto = descuadres.filter((d) => !d.tieneReparto).length;
  console.log(
    `\nPISTA: ${descuadres.length - sinReparto} de ${descuadres.length} son de clientes CON repartos` +
      (sinReparto > 0
        ? `, y ${sinReparto} NO — o sea que hay un segundo escritor que tampoco recalcula.`
        : ". El sospechoso es el escritor del reparto."),
  );
  console.log(
    "ARREGLO de los datos ya escritos: `select public.recalc_client_running_balance('<client_id>');`",
  );
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
