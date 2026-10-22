// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Vigila `normalize_whatsapp_phone` después de la migración `136`: que el
// mismo teléfono escrito de las dos formas dé UNA clave, y —tan importante—
// que un número que no se pueda situar con certeza se quede como estaba.
//
// NO ESCRIBE NADA.
//
// ===========================================================================
// LAS DOS MITADES, Y LA SEGUNDA ES LA QUE PROTEGE A ALGUIEN
//
// La mitad fácil es que `04149900094` y `+584149900094` acaben en la misma
// clave. Si eso se rompe, el síntoma es el de siempre: a alguien se le vuelve
// a preguntar un permiso que ya dio. Molesto y recuperable.
//
// La mitad que importa es la contraria: que `4045551234` NO se archive como
// venezolano. 404 y 415 son indicativos reales de EE. UU. y una regla de
// «empieza por 4» los fusionaría con un móvil venezolano. El síntoma de ESE
// fallo es que alguien recibe el saldo de otra persona — el peor que tiene
// este producto, y el único irreversible.
//
// Por eso las filas de «no toca» no son relleno: son la mitad del archivo.
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
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
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

const norm = async (t) => {
  const { data, error } = await admin.rpc("normalize_whatsapp_phone", { p_raw: t });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data;
};

// ── ¿está corrida la 136? ────────────────────────────────────────────────
//
// Se comprueba lo primero y con su propio mensaje: sin esto, TODAS las filas
// de abajo fallan a la vez y el motivo real queda enterrado bajo diez líneas
// rojas que parecen diez problemas distintos.
{
  const { data } = await admin
    .from("schema_migrations")
    .select("key")
    .eq("key", "136_un_numero_una_clave")
    .maybeSingle();
  if (!data) {
    console.error(
      "\nLa migración 136 no está corrida en esta base. Córrela antes:\n  supabase/136_un_numero_una_clave.sql\n",
    );
    process.exit(1);
  }
}

// ── 1. una persona, una clave ────────────────────────────────────────────
for (const [a, b, pais] of [
  ["04149900094", "+584149900094", "Venezuela móvil"],
  ["0414 990 00 94", "58 414 990 0094", "Venezuela con espacios"],
  ["03238130265", "+573238130265", "Colombia móvil"],
  ["02123334444", "+582123334444", "Venezuela fijo"],
  ["06012223333", "+576012223333", "Colombia fijo"],
]) {
  const [x, y] = [await norm(a), await norm(b)];
  check(`${pais}: «${a}» y «${b}» dan la misma clave`, x !== null && x === y, `${x} vs ${y}`);
}

// ── 2. lo que NO se debe tocar, que es la otra mitad ─────────────────────
for (const [t, porque] of [
  ["4045551234", "indicativo de Atlanta: una regla ancha lo haría venezolano"],
  ["4155551234", "indicativo de San Francisco, mismo caso"],
  ["1234567890", "lo que una libreta real tiene guardado como teléfono"],
]) {
  const r = await norm(t);
  check(`«${t}» NO recibe indicativo — ${porque}`, r === t, `devolvió ${r}`);
}

// ── 3. los 9 dígitos siguen fuera, como siempre ──────────────────────────
for (const t of ["987654321", "912345678"]) {
  const r = await norm(t);
  check(`«${t}» (9 dígitos, Perú/Chile) sigue dando null`, r === null, `devolvió ${r}`);
}

// ── 4. idempotente: canonizar lo canónico no lo mueve ────────────────────
//
// Es lo que permite re-ejecutar la migración, y lo que impide que una segunda
// pasada añada un indicativo encima de otro.
for (const t of ["584149900094", "573238130265", "1234567890"]) {
  const una = await norm(t);
  const dos = await norm(una);
  check(`«${t}»: normalizar dos veces da lo mismo`, una === dos, `${una} vs ${dos}`);
}

// ── 5. el registro quedó canonizado ──────────────────────────────────────
{
  const { data } = await admin.from("client_whatsapp_consents").select("phone");
  const sueltos = [];
  for (const c of data ?? []) {
    const canon = await norm(c.phone);
    if (canon !== c.phone) sueltos.push(`${c.phone} -> ${canon}`);
  }
  check(
    "ninguna fila del registro se puede canonizar más",
    sueltos.length === 0,
    sueltos.join(", "),
  );
}

// ── 6. EL CONTROL DE MUNDO REAL, y es el que vale ────────────────────────
//
// Todo lo de arriba se lo pregunta la suite a la función. Esta fila pregunta
// a la PUERTA DE ENVÍO, que es quien decide de verdad si a alguien se le
// escribe: busca una ficha cuyo teléfono tenga permiso en el registro y
// comprueba que `client_accepts_whatsapp` dice que sí.
//
// Antes de la `136`, en dev, nueve fichas con `573238130265` tenían su
// permiso guardado como `3238130265` y las nueve contestaban que no.
{
  const { data: consents } = await admin
    .from("client_whatsapp_consents")
    .select("phone, event, occurred_at")
    .order("occurred_at", { ascending: false });
  const ultimo = new Map();
  for (const c of consents ?? []) if (!ultimo.has(c.phone)) ultimo.set(c.phone, c.event);
  const conceden = [...ultimo].filter(([, e]) => e === "granted").map(([p]) => p);

  const { data: fichas } = await admin
    .from("clients")
    .select("id, name, whatsapp")
    .not("whatsapp", "is", null)
    .is("trashed_at", null)
    .is("deleted_at", null);

  let comprobadas = 0;
  let fallan = [];
  for (const f of fichas ?? []) {
    const clave = await norm(f.whatsapp);
    if (!clave || !conceden.includes(clave)) continue;
    comprobadas++;
    const { data: puerta } = await admin.rpc("client_accepts_whatsapp", { p_client_id: f.id });
    if (puerta !== true) fallan.push(f.name);
  }
  check(
    `las fichas cuyo número concede son vistas por la puerta de envío (${comprobadas} comprobadas)`,
    comprobadas > 0 && fallan.length === 0,
    fallan.length ? `no las ve: ${fallan.join(", ")}` : `${comprobadas} fichas`,
  );
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
