// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// LA DESCARGA DE MOVIMIENTOS DE `/reportes`, pedida por el dueño el
// 2026-10-27. **No escribe nada**: pide el fichero y lo contrasta contra la
// base.
//
// ═══════════════════════════════════════════════════════════════════════
// CORRE COMO EL DUEÑO, CON SU COOKIE, Y ESO NO ES UN DETALLE
//
// `CLAUDE.md` lo tiene escrito: un guion de `qa/` autenticado con la clave de
// servicio se salta RLS y no necesita `grant`, así que no puede ver los dos
// fallos que más veces han roto una pantalla -- una política que filtra las
// filas del dueño, y un permiso que falta.
//
// Aquí además la cookie es obligatoria por otro motivo: **la ruta lee la
// sesión de las cookies**, no de una cabecera `Authorization`. Un cliente con
// `Bearer` --el patrón de `qa/pedidos.mjs`-- no sirve para llamarla. El molde
// de la cookie sale de `qa/venta-accion.mjs`.
//
// NECESITA `npm run dev` CORRIENDO. Sin servidor falla en el control 0, que es
// una fila roja que dice «no había servidor», no «el código está roto» -- la
// trampa 1 del `qa-regression-checklist`.
//
// ═══════════════════════════════════════════════════════════════════════
// QUÉ VIGILA, Y POR QUÉ CADA COSA
//
//   1. **El BOM.** Sin los tres bytes, Excel en Windows parte «Peña». Se mide
//      en BYTES y no con `.text()`: el decodificador de `fetch` se COME el
//      BOM por especificación, así que mirar el primer carácter da «no hay
//      BOM» con el BOM puesto. Ese falso negativo ya costó un rato hoy.
//   2. **El `Content-Length` contra los bytes recibidos.** Contar caracteres
//      en vez de bytes daría una cifra corta y el fichero llegaría truncado.
//   3. **Las filas contra el conteo de la base.** Es la parada dura: si
//      PostgREST cortara en 1.000, la ruta tiene que NEGARSE a entregar, no
//      entregar mil y callar.
//   4. **El saldo final contra el neto de `movements`.** La cifra que el
//      fichero afirma, recalculada desde la base por otro camino.
//   5. **El saldo inicial contra la ventana anterior**, por el mismo motivo.
//   6. **Los dos libros de un negocio venezolano**, aunque uno esté vacío: un
//      bloque EUR ausente se lee como «no se exportó».
//   7. **Un rango ausente se RECHAZA.** Una pantalla no puede quedarse en
//      blanco y por eso `rangoDe` adivina; un fichero sí puede no existir, y
//      uno con el rango adivinado es peor que ninguno.
//   8. **El borde de medianoche**, que es lo que la zona del negocio decide:
//      ninguna fila del fichero puede caer fuera de la ventana resuelta.
// ═══════════════════════════════════════════════════════════════════════

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

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

async function cookieDelDueno(ownerId) {
  const { data: u, error: eU } = await admin.auth.admin.getUserById(ownerId);
  if (eU) throw new Error(`getUserById: ${eU.message}`);
  const { data: link, error: eL } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: u.user.email,
  });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: v, error: eV } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  const nombre = `sb-${ref}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(v.session), "utf8").toString("base64url");
  const MAX = 3180;
  return (
    valor.length <= MAX
      ? [`${nombre}=${valor}`]
      : Array.from(
          { length: Math.ceil(valor.length / MAX) },
          (_, i) => `${nombre}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        )
  ).join("; ");
}

// ── A QUIÉN SE LE PIDE EL FICHERO ────────────────────────────────────────
//
// VENEZOLANO a propósito: lleva dos libros, que es donde se rompe el bloque
// por moneda. Uno colombiano pasaría con una sola columna.
//
// Y EL QUE MÁS MOVIMIENTOS TENGA, no el primero que salga. La primera versión
// de este guion cogía el más antiguo, le tocó un negocio de pruebas **con
// CERO movimientos en el rango**, y las catorce filas salieron verdes sin
// comprobar nada: los saldos cuadraban porque los dos lados eran cero. Es el
// mismo fallo que `qa:catalogo-bordes` tuvo el mes pasado -- una suite que
// pasa con la prueba vacía no es una suite, es un adorno. Por eso además
// abajo hay una fila que EXIGE que el caso no sea trivial.
const hoy = new Date();
const aISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const HASTA = aISO(hoy);
const DESDE = aISO(new Date(hoy.getTime() - 29 * 86_400_000));
// Venezuela, UTC−4, sin horario de verano. Los mismos instantes que calcula
// `ventanaDelNegocio`, escritos aquí a mano a propósito: si los importara del
// mismo módulo, esta comprobación sería un eco en vez de una prueba.
const DESDE_UTC = new Date(`${DESDE}T00:00:00.000-04:00`);
const HASTA_UTC = new Date(new Date(`${HASTA}T00:00:00.000-04:00`).getTime() + 86_400_000);

const { data: candidatos, error: eD } = await admin
  .from("owners")
  .select("id, business_name, country")
  .eq("country", "VE");
if (eD || !candidatos?.length) throw new Error(`no hay dueño VE en dev: ${eD?.message ?? "ninguno"}`);

let dueno = null;
let masFilas = -1;
for (const c of candidatos) {
  const { data: cs } = await admin.from("clients").select("id").eq("owner_id", c.id);
  const suyos = (cs ?? []).map((x) => x.id);
  if (!suyos.length) continue;
  const { count } = await admin
    .from("movements")
    .select("id", { count: "exact", head: true })
    .in("client_id", suyos)
    .is("deleted_at", null)
    .gte("created_at", DESDE_UTC.toISOString())
    .lt("created_at", HASTA_UTC.toISOString());
  if ((count ?? 0) > masFilas) {
    masFilas = count ?? 0;
    dueno = c;
  }
}
if (!dueno) throw new Error("ningún dueño VE de dev tiene clientes");
console.log(
  `Dueño: ${dueno.business_name} (${dueno.country}) — ${masFilas} movimientos en el rango\nServidor: ${BASE}\n`,
);

const cookie = await cookieDelDueno(dueno.id);

const url = `${BASE}/api/reportes/movimientos?desde=${DESDE}&hasta=${HASTA}`;
const res = await fetch(url, { headers: { Cookie: cookie }, redirect: "manual" });
check(
  `0. ${BASE} contesta la descarga con la sesión del dueño`,
  res.status === 200,
  res.status === 200 ? undefined : `devolvió ${res.status} (¿está \`npm run dev\` corriendo?)`,
);
if (res.status !== 200) {
  console.log(`\n0/${filas.length} pasan.`);
  process.exit(1);
}

const bytes = new Uint8Array(await res.arrayBuffer());
const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
const lineas = csv.split("\r\n");

check(
  "1. el fichero empieza por el BOM (EF BB BF), medido en bytes",
  bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
  `primeros bytes: ${[...bytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`,
);

check(
  "2. el Content-Length declarado son los bytes que llegaron",
  Number(res.headers.get("content-length")) === bytes.length,
  `declara ${res.headers.get("content-length")}, llegaron ${bytes.length}`,
);

check(
  "2b. se entrega como adjunto y no se cachea",
  (res.headers.get("content-disposition") ?? "").startsWith("attachment;") &&
    (res.headers.get("cache-control") ?? "").includes("no-store"),
  `${res.headers.get("content-disposition")} / ${res.headers.get("cache-control")}`,
);

// ── CONTRA LA BASE ───────────────────────────────────────────────────────
const { data: clientes } = await admin.from("clients").select("id").eq("owner_id", dueno.id);
const ids = (clientes ?? []).map((c) => c.id);

const { count: enLaBase } = await admin
  .from("movements")
  .select("id", { count: "exact", head: true })
  .in("client_id", ids)
  .is("deleted_at", null)
  .gte("created_at", DESDE_UTC.toISOString())
  .lt("created_at", HASTA_UTC.toISOString());

const declaradas = Number(
  /Movimientos exportados;(\d+)/.exec(csv)?.[1] ?? -1,
);
// Las filas de verdad: todo lo que lleva un uuid en la última columna.
const filasDeDatos = lineas.filter((l) => /;[0-9a-f-]{36}$/.test(l));
check(
  "3. las filas del fichero son las que cuenta la base",
  declaradas === enLaBase && filasDeDatos.length === enLaBase,
  `base ${enLaBase}, cabecera ${declaradas}, filas con id ${filasDeDatos.length}`,
);

check(
  "3b. el caso de prueba NO es trivial: hay movimientos que comprobar",
  enLaBase > 0,
  enLaBase > 0
    ? `${enLaBase} en el rango`
    : "cero filas en el rango: los saldos cuadrarian solos y esta suite no estaria mirando nada",
);

// Todos los movimientos vivos hasta el fin del rango, paginando.
const todos = [];
for (let p = 0; ; p++) {
  const { data, error } = await admin
    .from("movements")
    .select("type, amount, currency, created_at")
    .in("client_id", ids)
    .is("deleted_at", null)
    .lt("created_at", HASTA_UTC.toISOString())
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(p * 1000, p * 1000 + 999);
  if (error) throw new Error(`movements: ${error.message}`);
  todos.push(...data);
  if (data.length < 1000) break;
}

const neto = { USD: 0, EUR: 0 };
const apertura = { USD: 0, EUR: 0 };
for (const m of todos) {
  const l = m.currency ?? "COP";
  if (!(l in neto)) continue;
  const v = m.type === "charge" ? Number(m.amount) : -Number(m.amount);
  neto[l] += v;
  if (new Date(m.created_at) < DESDE_UTC) apertura[l] += v;
}

const cifra = (s) => Number(s.replace(/\./g, "").replace(",", "."));
function saldoDelFichero(libro, cual) {
  const i = lineas.findIndex((l) => l === `Libro;${libro}`);
  if (i < 0) return null;
  const fin = lineas.findIndex((l, j) => j > i && l.startsWith("Libro;"));
  const bloque = lineas.slice(i, fin < 0 ? undefined : fin);
  const f = bloque.find((l) => l.includes(`;saldo ${cual}`));
  return f ? cifra(f.split(";")[10]) : null;
}

for (const libro of ["USD", "EUR"]) {
  check(
    `4. saldo final ${libro}: el del fichero es el neto de la base`,
    Math.abs((saldoDelFichero(libro, "final") ?? NaN) - neto[libro]) < 0.005,
    `fichero ${saldoDelFichero(libro, "final")}, base ${neto[libro].toFixed(2)}`,
  );
  check(
    `5. saldo inicial ${libro}: el del fichero es el neto anterior al rango`,
    Math.abs((saldoDelFichero(libro, "inicial") ?? NaN) - apertura[libro]) < 0.005,
    `fichero ${saldoDelFichero(libro, "inicial")}, base ${apertura[libro].toFixed(2)}`,
  );
}

check(
  "6. un negocio venezolano trae sus DOS libros, aunque uno esté vacío",
  lineas.includes("Libro;USD") && lineas.includes("Libro;EUR"),
  lineas.filter((l) => l.startsWith("Libro;")).join(" / "),
);

// ── LO QUE TIENE QUE NEGARSE ─────────────────────────────────────────────
const sinRango = await fetch(`${BASE}/api/reportes/movimientos`, {
  headers: { Cookie: cookie },
  redirect: "manual",
});
check(
  "7. sin fechas NO adivina un rango: vuelve a /reportes con el motivo",
  sinRango.status === 303 &&
    (sinRango.headers.get("location") ?? "").includes("motivo=rango"),
  `${sinRango.status} ${sinRango.headers.get("location")}`,
);

const sinSesion = await fetch(url, { redirect: "manual" });
check(
  "7b. sin sesión no entrega nada: manda al login",
  // CUALQUIER REDIRECCION AL LOGIN VALE, y no un codigo concreto: quien la
  // responde es el middleware, ANTES de que la ruta corra, y usa 307. Fijar
  // el 303 de la ruta aqui seria atar la prueba a quien contesta hoy en vez
  // de a lo que importa -- que no sale un CSV.
  [301, 302, 303, 307, 308].includes(sinSesion.status) &&
    (sinSesion.headers.get("location") ?? "").includes("/login") &&
    !(sinSesion.headers.get("content-type") ?? "").includes("csv"),
  `${sinSesion.status} ${sinSesion.headers.get("location")}`,
);

const ajeno = await fetch(`${url}&cliente=00000000-0000-0000-0000-000000000000`, {
  headers: { Cookie: cookie },
  redirect: "manual",
});
check(
  "7c. un cliente que no es suyo se rechaza, no devuelve un fichero vacío",
  ajeno.status === 303 && (ajeno.headers.get("location") ?? "").includes("motivo=cliente"),
  `${ajeno.status} ${ajeno.headers.get("location")}`,
);

// ── EL BORDE DE MEDIANOCHE ───────────────────────────────────────────────
//
// Cada fecha del fichero se escribe en la zona del negocio, así que ninguna
// puede salirse del rango que el tendero pidió. Un fallo aquí no se ve: las
// filas de los extremos simplemente serían de otro día.
const fechasFuera = filasDeDatos
  .map((l) => l.split(";")[1])
  .filter((f) => f < DESDE || f > HASTA);
check(
  "8. ninguna fila cae fuera del rango pedido, leída en la zona del negocio",
  fechasFuera.length === 0,
  fechasFuera.length ? `fuera: ${[...new Set(fechasFuera)].join(", ")}` : `${DESDE} … ${HASTA}`,
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
