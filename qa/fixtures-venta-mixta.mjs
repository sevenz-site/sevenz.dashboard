// LOS CASOS DE PRUEBA DEL DETALLE POR MONEDA, registrados por la acción real.
//
// Pedido del dueño el 2026-10-20: *«Realiza la prueba tú mismo haciendo
// registros y deja los registros de prueba para auditarte»*.
//
// ===========================================================================
// POR QUÉ POR LA ACCIÓN Y NO INSERTANDO FILAS
//
// Un fixture montado a mano con la clave de servicio se puede escribir mal y
// nadie se entera: pone una venta que `registrarVenta` nunca habría guardado,
// y la pantalla se construye contra datos que no existen en la realidad. Esto
// llama a `registrarVenta` por HTTP con la sesión del dueño, igual que
// `qa/venta-accion.mjs`, así que lo que queda en la base es exactamente lo que
// deja el asistente de venta.
//
// ===========================================================================
// SOLO CONTRA LA RAMA DEV
//
// Se niega a correr si `.env.local` no apunta a `vzqppwrwnmlbrxizskdh`. Escribe
// datos, y escribir datos de prueba en producción no se arregla con un `delete`.
//
// NO LIMPIA AL TERMINAR, y es lo que lo diferencia de las suites de `qa/`: el
// dueño pidió que los registros se queden para poder auditarlos. Llevan la
// marca `QA MIXTA` en el nombre del cliente y de los productos, y están
// anotados en `CT-113`.
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
const MARCA = "QA MIXTA";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── El id de una server action, leído de los chunks que sirve el servidor ──
//
// Copiado de `qa/venta-accion.mjs`, donde está explicado entero: Next no
// publica un índice, así que el id se empareja con el nombre DENTRO de su
// propia llamada en el chunk del cliente.
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

// El objeto de la acción, recortado contando llaves. Una expresión regular se
// para en la primera `}` y devuelve medio objeto — ver el comentario largo en
// `qa/venta-accion.mjs`.
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

const hechos = [];

try {
  // ── LA SESIÓN DEL DUEÑO, sin teclear contraseña ─────────────────────────
  const { data: duenio } = await admin
    .from("owners")
    .select("id, business_name, email")
    .eq("email", "contactojesusdelgado@gmail.com")
    .single();

  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: duenio.email,
  });
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
  console.log(`id de registrarVenta: ${accionVenta.slice(0, 10)}…`);

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

  // ── PRODUCTOS, uno por moneda ───────────────────────────────────────────
  async function producto(nombre, moneda, precio) {
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
        base_currency: moneda,
        base_currency_retail: moneda,
        base_currency_wholesale: moneda,
        price_retail: precio,
        published_retail: true,
        published_wholesale: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`producto ${nombre}: ${error.message}`);
    return data.id;
  }

  const enDolares = await producto("linterna", "USD", 20);
  const enEuros = await producto("termo", "EUR", 30);

  // ── UN CLIENTE POR CASO, para que cada ficha se mire aislada ────────────
  async function cliente(sufijo) {
    const nombre = `${MARCA} ${sufijo}`;
    const { data: ya } = await admin
      .from("clients")
      .select("id")
      .eq("owner_id", duenio.id)
      .eq("name", nombre)
      .is("deleted_at", null)
      .maybeSingle();
    if (ya) return ya.id;
    const { data, error } = await admin
      .from("clients")
      .insert({ owner_id: duenio.id, name: nombre })
      .select("id")
      .single();
    if (error) throw new Error(`cliente ${sufijo}: ${error.message}`);
    return data.id;
  }

  async function caso(titulo, sufijo, entrada) {
    const clientId = await cliente(sufijo);
    const r = await registrarVenta({ clientId, ...entrada });
    if (!r.ok) {
      console.log(`✗ ${titulo}\n   rechazada: ${r.error}`);
      hechos.push({ titulo, ok: false, detalle: r.error });
      return null;
    }
    const { data: movs } = await admin
      .from("movements")
      .select("id, type, amount, currency, plazo_dias, cuotas")
      .eq("sale_id", r.saleId)
      .is("deleted_at", null);
    console.log(`✓ ${titulo}`);
    console.log(`   cliente  http://localhost:3000/clients/${clientId}`);
    for (const m of movs ?? []) {
      console.log(
        `   fiado    http://localhost:3000/transacciones/${m.id}   ${m.amount} ${m.currency} plazo=${m.plazo_dias} cuotas=${m.cuotas}`,
      );
    }
    if ((movs ?? []).length === 0) console.log("   (sin movimientos: contado puro)");
    hechos.push({ titulo, ok: true, saleId: r.saleId, clientId, movs: movs ?? [] });
    return { saleId: r.saleId, clientId, movs: movs ?? [] };
  }

  console.log("\n══ CASOS ══════════════════════════════════════════════════\n");

  // 1. El caso reportado: una moneda al contado, la otra a crédito.
  await caso("1. VENTA MIXTA — dólares de contado, euros a crédito", "mixta", {
    lineas: [
      { productId: enDolares, quantity: 2, currency: "USD" },
      { productId: enEuros, quantity: 1, currency: "EUR" },
    ],
    pagos: [{ currency: "USD", amount: 40 }],
    credito: [{ currency: "EUR", plazoDias: 7, cuotas: 4 }],
  });

  // 2. El que NO existía y es la rama más delicada: dos fiados, dos plazos.
  await caso("2. DOS FIADOS — monedas y plazos distintos, nada pagado", "dos fiados", {
    lineas: [
      { productId: enDolares, quantity: 3, currency: "USD" },
      { productId: enEuros, quantity: 2, currency: "EUR" },
    ],
    pagos: [],
    credito: [
      { currency: "USD", plazoDias: 30, cuotas: null },
      { currency: "EUR", plazoDias: 7, cuotas: 4 },
    ],
  });

  // 3. Contado puro: hoy no tiene pantalla y va a ganarla.
  await caso("3. CONTADO PURO — una sola moneda, pagada entera", "contado", {
    lineas: [{ productId: enDolares, quantity: 1, currency: "USD" }],
    pagos: [{ currency: "USD", amount: 20 }],
    credito: [],
  });

  // 4. Un fiado en una sola moneda con abono inicial: «Abonó» de la 129.
  await caso("4. ABONO INICIAL — pagó una parte al registrar el fiado", "abono inicial", {
    lineas: [{ productId: enDolares, quantity: 5, currency: "USD" }],
    pagos: [{ currency: "USD", amount: 15 }],
    credito: [{ currency: "USD", plazoDias: 14, cuotas: 2 }],
  });

  // 5. El que va a quedar PAGADO al 100 %, para el rótulo nuevo.
  const pagado = await caso("5. PARA DEJARLO PAGADO AL 100 %", "pagado", {
    lineas: [{ productId: enDolares, quantity: 1, currency: "USD" }],
    pagos: [],
    credito: [{ currency: "USD", plazoDias: 10, cuotas: null }],
  });

  console.log("\n══ LO QUE QUEDA POR HACER A MANO ══════════════════════════\n");
  if (pagado?.movs?.[0]) {
    console.log(`Para el caso 5, abonar los ${pagado.movs[0].amount} ${pagado.movs[0].currency} enteros desde:`);
    console.log(`   http://localhost:3000/abonos/nuevo/${pagado.movs[0].id}/monto`);
  }
  console.log("\nY para ver «Plazo vencido» hace falta una fecha pasada: eso se");
  console.log("retrasa con `qa/fixtures-venta-mixta-vencer.mjs`, que es un guion");
  console.log("aparte justamente para que no se confunda con un registro real.\n");
} catch (e) {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
