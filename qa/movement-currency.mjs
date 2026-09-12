// SOLO EN EL BRANCH DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Prueba el invariante de moneda de resolveMovementRateSnapshot contra dueños
// reales de dev, sin escribir nada.
//
// Existe porque esta es la clase de fallo que ya llegó a producción dos veces
// y no se puede comprobar mirando: depende de country, de si hay tasa guardada
// y de lo que mande el formulario, y las tres cosas viven en sitios distintos.
//
// Lo que se afirma:
//   CO + lo que sea      -> currency null. Un negocio colombiano no tiene
//                           libro en dólares, mande el formulario lo que mande.
//   VE + sin moneda      -> RECHAZO. Es el caso que antes adivinaba.
//   VE + moneda          -> se acepta esa moneda, nunca otra.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolveMovementRateSnapshot } from "../lib/exchange-rate/resolve-movement-rate.ts";

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
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no al branch dev (${DEV_REF}).`);
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

const { data: owners } = await db.from("owners").select("id, business_name, country");
const co = owners.find((o) => o.country === "CO");
const ve = owners.find((o) => o.country === "VE");

check("hay un dueño CO y uno VE en dev", Boolean(co && ve), `${co?.business_name} · ${ve?.business_name}`);
if (!co || !ve) process.exit(1);

// ── dueño colombiano ────────────────────────────────────────────────────
for (const enviado of [null, "USD", "EUR"]) {
  const r = await resolveMovementRateSnapshot(db, co.id, enviado);
  check(
    `CO + ${enviado ?? "sin moneda"} -> currency null`,
    r.ok && r.snapshot.currency === null,
    r.ok ? `currency=${r.snapshot.currency}` : `rechazó: ${r.error}`,
  );
}

// ── dueño venezolano ────────────────────────────────────────────────────
const sinMoneda = await resolveMovementRateSnapshot(db, ve.id, null);
check(
  "VE + sin moneda -> RECHAZA (antes adivinaba USD)",
  !sinMoneda.ok,
  sinMoneda.ok ? `ACEPTÓ con currency=${sinMoneda.snapshot.currency}` : "rechazado",
);

for (const moneda of ["USD", "EUR"]) {
  const r = await resolveMovementRateSnapshot(db, ve.id, moneda);
  check(
    `VE + ${moneda} -> ${moneda}`,
    r.ok && r.snapshot.currency === moneda,
    r.ok ? `currency=${r.snapshot.currency} · tasa=${r.snapshot.exchangeRateUsed ?? "sin sellar"}` : `rechazó: ${r.error}`,
  );
}

// ── dueño que no se puede leer ──────────────────────────────────────────
// Un uuid que no existe hace que la lectura de owners falle, que es lo mismo
// que pasaría con un corte de red. Antes se plegaba a "es CO" y el movimiento
// caía en el libro colombiano; ahora tiene que rechazar.
const fantasma = await resolveMovementRateSnapshot(db, "00000000-0000-0000-0000-000000000000", "USD");
check(
  "dueño ilegible -> RECHAZA (no se pliega a CO)",
  !fantasma.ok,
  fantasma.ok ? `ACEPTÓ con currency=${fantasma.snapshot.currency}` : "rechazado",
);

// ── la invariante de fondo, sobre los datos que ya existen ──────────────
const todas = async (tabla, sel) => {
  const filas = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await db.from(tabla).select(sel).range(d, d + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return filas;
  }
};

const clientes = await todas("clients", "id, owner_id");
const movs = await todas("movements", "id, client_id, currency");
const paisDe = new Map(owners.map((o) => [o.id, o.country]));
const duenoDe = new Map(clientes.map((c) => [c.id, c.owner_id]));

const veEnLibroCop = movs.filter((m) => paisDe.get(duenoDe.get(m.client_id)) === "VE" && m.currency === null);
const coConMoneda = movs.filter((m) => paisDe.get(duenoDe.get(m.client_id)) === "CO" && m.currency !== null);

check("ningún movimiento VE en el libro COP", veEnLibroCop.length === 0, `${movs.length} movimientos revisados`);
check("ningún movimiento CO con moneda", coConMoneda.length === 0);

// ── autoría (migración 049) ─────────────────────────────────────────────
// Se comprueba aquí y no en un script aparte porque es la otra invariante de
// la misma escritura: todo movimiento tiene moneda correcta y autor conocido.
const conAutor = await todas("movements", "id, client_id, created_by");
const sinAutor = conAutor.filter((m) => !m.created_by);
check("ningún movimiento sin autor", sinAutor.length === 0, `${conAutor.length} revisados`);

// Mientras no exista membresía el autor solo puede ser el dueño del cliente.
// El día que eso deje de ser cierto, esta afirmación falla — y esa es
// justamente la señal de que hay que reescribirla, no de que algo se rompió.
const autorAjeno = conAutor.filter((m) => m.created_by !== duenoDe.get(m.client_id));
check(
  "el autor coincide con el dueño del cliente",
  autorAjeno.length === 0,
  autorAjeno.length ? `${autorAjeno.length} con otro autor — ¿llegó la membresía?` : "un solo autor posible hoy",
);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
