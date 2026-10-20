// EL CAMINO COLOMBIANO DE LA VENTA, que no existía en dev y por eso un fallo
// entero se coló sin que nada se quejara.
//
// ===========================================================================
// QUÉ SE ESCAPÓ, Y POR QUÉ ESTE GUION EXISTE
//
// La migración `131` --la que le enseña al CLIENTE sus compras de contado--
// cruzaba `sale_payments.currency` contra `movements.currency` dando por hecho
// que las dos columnas escriben lo mismo. No lo hacen:
//
//   `sale_payments.currency` / `sale_lines.currency`   guardan 'COP'
//   `movements.currency`                               guarda  NULL
//
// Así que para un negocio colombiano el cruce no casaba nunca, no excluía
// nada, y CADA FIADO habría sacado además una fila de «De contado» fantasma
// por su importe entero, en la pantalla del propio cliente. Su deuda listada
// dos veces: una como debida y otra como ya pagada.
//
// NO LO CAZÓ NINGUNA PRUEBA porque en dev no había NI UNA fila con 'COP' en
// `sale_payments`: los seis negocios colombianos tenían fiados y cero ventas.
// La migración corrió, devolvió filas correctas para el cliente venezolano
// contra el que se probó, y estaba equivocada para un país entero.
//
// Este guion deja ese dato puesto, para que la próxima vez haya contra qué
// chocar.
//
// ===========================================================================
// POR LA ACCIÓN REAL, SOLO CONTRA DEV, Y NO LIMPIA
//
// Las tres cosas por lo mismo que `qa/fixtures-venta-mixta.mjs`, que explica
// cada una: un fixture montado a mano con la clave de servicio puede guardar
// una venta que `registrarVenta` nunca habría escrito, y entonces la pantalla
// se prueba contra datos que no existen en la realidad.
//
// Los registros se quedan, con la marca `QA COP`, y están anotados en
// `CT-113`.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`Este guion solo corre contra la rama DEV (${DEV_REF}). .env.local apunta a ${ref}.`);
  process.exit(1);
}

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const MARCA = "QA COP";
// El dueño colombiano con el que se prueba. Tiene país 'CO', así que
// `registrarVenta` resuelve su libro a NULL, que es el caso entero.
const DUENIO_CO = "companiastartup@gmail.com";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Copiadas de `qa/fixtures-venta-mixta.mjs`, donde están explicadas enteras.
async function idDeLaAccion(base, nombre, cookie, ruta) {
  const html = await (await fetch(`${base}${ruta}`, { headers: { Cookie: cookie } })).text();
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+?\.js/g)].map((m) => m[0]);
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const c of [...new Set(chunks)]) {
    let t;
    try {
      t = await (await fetch(`${base}${c}`)).text();
    } catch {
      continue;
    }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

function objetoDeLaRespuesta(texto) {
  const i = texto.indexOf('{"ok":');
  if (i < 0) return null;
  let prof = 0;
  let enCadena = false;
  let escapado = false;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (escapado) { escapado = false; continue; }
    if (c === "\\") { escapado = true; continue; }
    if (c === '"') { enCadena = !enCadena; continue; }
    if (enCadena) continue;
    if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return JSON.parse(texto.slice(i, j + 1));
  }
  return null;
}

let fallos = 0;
let pasan = 0;
function comprobar(titulo, condicion, detalle) {
  if (condicion) {
    pasan++;
    console.log(`  ✓ ${titulo}`);
  } else {
    fallos++;
    console.log(`  ✗ ${titulo}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const { data: duenio, error: eDuenio } = await admin
  .from("owners")
  .select("id, email, business_name, country")
  .eq("email", DUENIO_CO)
  .single();
if (eDuenio) throw new Error(`no se encontró el dueño colombiano: ${eDuenio.message}`);
if (duenio.country !== "CO") throw new Error(`${DUENIO_CO} no es de país CO, es ${duenio.country}`);
console.log(`Dueño colombiano: ${duenio.business_name} (${duenio.country})\n`);

// ── LA SESIÓN, sin teclear contraseña ───────────────────────────────────
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: duenio.email });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);

const nombreCookie = `sb-${ref}-auth-token`;
const valor = "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
const MAX = 3180;
const cookie = (
  valor.length <= MAX
    ? [`${nombreCookie}=${valor}`]
    : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) =>
        `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
      )
).join("; ");

const accionVenta = await idDeLaAccion(BASE, "registrarVenta", cookie, "/ventas/nueva");
if (!accionVenta) throw new Error("no se encontró el id de registrarVenta en los chunks");

async function registrarVenta(entrada) {
  const res = await fetch(`${BASE}/ventas/nueva`, {
    method: "POST",
    headers: {
      "Next-Action": accionVenta,
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookie,
    },
    body: JSON.stringify([entrada]),
  });
  const r = objetoDeLaRespuesta(await res.text());
  if (!r) throw new Error("la acción no devolvió un resultado reconocible");
  return r;
}

// ── UN PRODUCTO EN PESOS ────────────────────────────────────────────────
async function producto(nombre, precio) {
  const { data: ya } = await admin
    .from("products")
    .select("id")
    .eq("owner_id", duenio.id)
    .eq("name", `${MARCA} ${nombre}`)
    .is("deleted_at", null)
    .maybeSingle();
  if (ya) return ya.id;
  const { data, error } = await admin
    .from("products")
    .insert({
      owner_id: duenio.id,
      name: `${MARCA} ${nombre}`,
      base_currency: "COP",
      base_currency_retail: "COP",
      base_currency_wholesale: "COP",
      price_retail: precio,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`producto ${nombre}: ${error.message}`);
  return data.id;
}

async function clienteConEnlace(sufijo) {
  const nombre = `${MARCA} ${sufijo}`;
  let id;
  const { data: ya } = await admin
    .from("clients")
    .select("id")
    .eq("owner_id", duenio.id)
    .eq("name", nombre)
    .is("deleted_at", null)
    .maybeSingle();
  if (ya) {
    id = ya.id;
  } else {
    const { data, error } = await admin
      .from("clients")
      .insert({ owner_id: duenio.id, name: nombre })
      .select("id")
      .single();
    if (error) throw new Error(`cliente ${sufijo}: ${error.message}`);
    id = data.id;
  }
  // El enlace compartido, que es lo que esta prueba necesita mirar.
  const { data: enlace } = await admin
    .from("share_links")
    .select("token")
    .eq("client_id", id)
    .maybeSingle();
  if (enlace) return { id, token: enlace.token };
  const { data: nuevo, error } = await admin
    .from("share_links")
    .insert({ client_id: id })
    .select("token")
    .single();
  if (error) throw new Error(`enlace de ${sufijo}: ${error.message}`);
  return { id, token: nuevo.token };
}

const arroz = await producto("arroz", 8000);

// UNA VENTA POR CLIENTE, Y NO MÁS. Este guion se corre varias veces --cada
// vez que se toque la `131`-- y sin esto la segunda pasada deja dos ventas
// iguales en el mismo cliente, así que «sale UNA fila» falla por culpa del
// guion y no del código. Pasó en la primera pasada, el 2026-10-20.
async function ventaUnaVez(cliente, entrada) {
  const { data: ya } = await admin
    .from("sales")
    .select("id")
    .eq("client_id", cliente.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (ya) return { ok: true, saleId: ya.id, reutilizada: true };
  return registrarVenta({ clientId: cliente.id, ...entrada });
}

console.log("══ LOS TRES CASOS ══════════════════════════════════════════\n");

// ── CASO 1: venta pagada entera. Tiene que salir UNA fila de contado ────
const contado = await clienteConEnlace("contado");
const r1 = await ventaUnaVez(contado, {
  lineas: [{ productId: arroz, quantity: 2, currency: "COP" }],
  pagos: [{ currency: "COP", amount: 16000 }],
  credito: [],
});
console.log(`1. CONTADO PURO EN PESOS — ${r1.ok ? "registrada" : `RECHAZADA: ${r1.error}`}`);
console.log(`   /s/${contado.token}`);

// ── CASO 2: venta entera a crédito, sin un peso pagado ─────────────────
//
// NO DESTAPA EL FALLO POR SÍ SOLO, y conviene decirlo porque la primera
// versión de este guion creyó que sí: sin NINGÚN pago, la consulta no tiene
// de dónde sacar una fila de contado, equivocada o no, así que pasaba en
// verde con el cruce roto. Es el control de que un fiado limpio no inventa
// nada.
const fiado = await clienteConEnlace("fiado");
const r2 = await ventaUnaVez(fiado, {
  lineas: [{ productId: arroz, quantity: 3, currency: "COP" }],
  pagos: [],
  credito: [{ currency: "COP", plazoDias: 15, cuotas: null }],
});
console.log(`2. FIADO PURO EN PESOS — ${r2.ok ? "registrada" : `RECHAZADA: ${r2.error}`}`);
console.log(`   /s/${fiado.token}`);

// ── CASO 3: fiado colombiano CON ABONO INICIAL ─────────────────────────
//
// ESTE ES EL QUE DESTAPA EL FALLO, y es el que faltaba.
//
// Una venta que deja un pago Y un cargo EN EL MISMO LIBRO es la única forma
// de que el cruce tenga algo que excluir. Con el cruce mal --'COP' contra
// ''-- el abono de 8.000 sale ADEMÁS como una fila de «De contado» de 8.000,
// al lado de su fiado de 16.000: el cliente ve un pago que no hizo. Abonó
// 8.000 a cuenta y la pantalla se lo cuenta como una compra aparte, saldada.
const mixto = await clienteConEnlace("abono inicial");
const r3 = await ventaUnaVez(mixto, {
  lineas: [{ productId: arroz, quantity: 3, currency: "COP" }],
  pagos: [{ currency: "COP", amount: 8000 }],
  credito: [{ currency: "COP", plazoDias: 15, cuotas: null }],
});
console.log(`3. FIADO CON ABONO INICIAL EN PESOS — ${r3.ok ? "registrada" : `RECHAZADA: ${r3.error}`}`);
console.log(`   /s/${mixto.token}\n`);

if (!r1.ok || !r2.ok || !r3.ok) {
  console.error("Alguna venta no se registró; no tiene sentido comprobar la función.");
  process.exit(1);
}

console.log("══ LO QUE VE EL CLIENTE ════════════════════════════════════\n");

async function contadoDe(token) {
  const { data, error } = await admin.rpc("get_shared_balance", { p_token: token });
  if (error) throw new Error(`get_shared_balance: ${error.message}`);
  return data;
}

const v1 = await contadoDe(contado.token);
console.log("Cliente de la venta pagada:");
comprobar(
  "sale una fila de contado, y solo una",
  (v1.ventas_de_contado ?? []).length === 1,
  `salieron ${(v1.ventas_de_contado ?? []).length}`,
);
const f1 = (v1.ventas_de_contado ?? [])[0];
if (f1) {
  comprobar("su libro es el nulo, no 'COP'", f1.currency === null, `currency = ${JSON.stringify(f1.currency)}`);
  comprobar("su importe son los 16.000 cobrados", Number(f1.amount) === 16000, `amount = ${f1.amount}`);
  comprobar(
    "trae su línea de producto",
    (f1.lineas ?? []).length === 1 && f1.lineas[0].name.includes("arroz"),
    `lineas = ${JSON.stringify(f1.lineas)}`,
  );
}

const v2 = await contadoDe(fiado.token);
console.log("\nCliente del fiado puro — AQUÍ ESTABA EL FALLO:");
comprobar(
  "NO sale ninguna fila de contado",
  (v2.ventas_de_contado ?? []).length === 0,
  `salieron ${(v2.ventas_de_contado ?? []).length}: ${JSON.stringify(v2.ventas_de_contado)}`,
);
comprobar(
  "su fiado sí está, como movimiento",
  (v2.movements ?? []).some((m) => m.type === "charge" && Number(m.amount) === 24000),
  `movimientos = ${JSON.stringify((v2.movements ?? []).map((m) => [m.type, m.amount, m.currency]))}`,
);

const v3 = await contadoDe(mixto.token);
console.log("\nCliente del fiado con abono inicial — AQUÍ ESTÁ EL FALLO:");
comprobar(
  "NO sale fila de contado por el abono inicial",
  (v3.ventas_de_contado ?? []).length === 0,
  `salieron ${(v3.ventas_de_contado ?? []).length}: ${JSON.stringify(v3.ventas_de_contado)}\n      ` +
    `← el cruce de monedas no excluye el libro que ya tiene cargo`,
);
comprobar(
  "su fiado está por los 16.000 que quedaron debiendo",
  (v3.movements ?? []).some((m) => m.type === "charge" && Number(m.amount) === 16000),
  `movimientos = ${JSON.stringify((v3.movements ?? []).map((m) => [m.type, m.amount, m.currency]))}`,
);

console.log(`\n${pasan}/${pasan + fallos} pasan.`);
process.exit(fallos > 0 ? 1 : 0);
