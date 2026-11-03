// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh). Se niega a correr contra otra.
//
// Crea un negocio de DEMOSTRACIÓN inventado, "Mini abasto El Chino", para
// fotografiar la app y alimentar la web nueva. Existe porque los datos reales
// de dev son de prueba (`QA MIXTA dos fiados`, `Pepa negocio`, hasta el nombre
// del dueño) y una web pública no puede enseñar eso.
//
// NADA DE LO QUE SALE AQUÍ ES REAL: ni los nombres, ni los teléfonos (patrón
// 555, que ningún operador venezolano emite), ni las cifras. Los nombres son
// comunes en Venezuela a propósito, para que la captura se lea creíble, pero
// no corresponden a nadie.
//
// IDEMPOTENTE: lo primero que hace es borrar al dueño de demostración y todo lo
// suyo, y lo recrea. Correrlo dos veces deja el mismo negocio, no dos.
//
// Escribe un manifiesto (`demo-manifest.json`) con los ids que necesita el
// script de capturas. No contiene ningún secreto.
//
//   node seed-demo.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url)).split(String.fromCharCode(92)).join("/").replace(/\/$/, "");
const { createClient } = createRequire(`${ROOT}/dashboard/package.json`)("@supabase/supabase-js");
const sharp = createRequire(`${ROOT}/Web/package.json`)("sharp");

const env = Object.fromEntries(
  readFileSync(`${ROOT}/dashboard/.env.local`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
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

const EMAIL = "demo-landing@sevenz-demo.test";
const NEGOCIO = "Mini abasto El Chino";

// Determinista: la misma semilla da el mismo negocio. Mulberry32.
let semilla = 20261030;
const azar = () => {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const r2 = (n) => Math.round(n * 100) / 100;

const AHORA = Date.now();
const hace = (dias, hora = 10) => {
  const d = new Date(AHORA - dias * 86400000);
  d.setUTCHours(hora + 4, entre(0, 59), entre(0, 59), 0); // 4h: Caracas es UTC-4
  return d.toISOString();
};

// ── La tasa de hoy, para que los bolívares de cada fila sean los de verdad ─
const { data: tasaFila } = await admin
  .from("bcv_exchange_rate_fetches")
  .select("usd, eur")
  .order("fetched_at", { ascending: false })
  .limit(1)
  .single();
const TASA_USD = Number(tasaFila.usd);
const TASA_EUR = Number(tasaFila.eur);

// ══════════════════════════════════════════════════════════════════════════
// 1. LIMPIAR, Y CREAR AL DUEÑO
// ══════════════════════════════════════════════════════════════════════════
const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
const previo = usuarios.data.users.find((u) => u.email === EMAIL);
if (previo) {
  const { data: archivos } = await admin.storage.from("product-photos").list(previo.id);
  if (archivos?.length) {
    await admin.storage.from("product-photos").remove(archivos.map((f) => `${previo.id}/${f.name}`));
  }
  await admin.auth.admin.deleteUser(previo.id);
  await admin.from("owners").delete().eq("id", previo.id);
  console.log("• dueño de demostración anterior borrado");
}

const { data: creado, error: eUser } = await admin.auth.admin.createUser({
  email: EMAIL,
  email_confirm: true,
  user_metadata: {
    business_name: NEGOCIO,
    first_name: "María",
    last_name: "Demo",
    whatsapp: "584145550100",
    country: "VE",
  },
});
if (eUser) throw new Error(`createUser: ${eUser.message}`);
const OWNER = creado.user.id;

await admin
  .from("owners")
  .update({
    business_name: NEGOCIO,
    first_name: "María",
    last_name: "Demo",
    country: "VE",
    plan: "pro",
    // Sin esto el tour de bienvenida tapa el panel en todas las capturas.
    onboarding_completed_at: new Date(AHORA - 40 * 86400000).toISOString(),
    accepted_terms_at: new Date(AHORA - 40 * 86400000).toISOString(),
    whatsapp_opt_in_at: new Date(AHORA - 30 * 86400000).toISOString(),
    whatsapp_opt_in_text: "Recibir resumen semanal de cartera en tu WhatsApp.",
    address: "Av. Principal, Caracas",
    low_stock_threshold: 5,
  })
  .eq("id", OWNER);

await admin.from("owner_exchange_settings").upsert({ owner_id: OWNER, rate_mode: "BCV_AUTO", display_currency: "USD" });
await admin.from("subscriptions").upsert({
  owner_id: OWNER,
  plan_code: "pro",
  estado: "activa",
  periodo_termina_el: new Date(AHORA + 300 * 86400000).toISOString(),
  periodicidad: "mensual",
  limites: { fotos_al_mes: null },
  precio_pactado_usd: 19.5,
  notas: "demo para capturas de la web",
});

// ══════════════════════════════════════════════════════════════════════════
// 2. PRODUCTOS, CON SU FOTO
//
// Las "fotos" son fichas de color con el nombre en grande, como la de HARINA
// que ya tenía dev: un producto sin foto se dibuja como un hueco gris con un
// icono tachado, y eso no es lo que un tendero con su catálogo montado vería.
// ══════════════════════════════════════════════════════════════════════════
const PRODUCTOS = [
  { k: "harina", n: "Harina de maíz 1 kg", p: 1.6, c: 1.15, mon: "USD", prov: "Distribuidora Andina", quedan: 24, bg: "#F2C14E", fg: "#3b2a00", t: "HARINA", may: [1.45, 12] },
  { k: "arroz", n: "Arroz blanco 1 kg", p: 1.45, c: 1.05, mon: "USD", prov: "Distribuidora Andina", quedan: 18, bg: "#EDE6D3", fg: "#3a3320", t: "ARROZ", may: [1.3, 12] },
  { k: "aceite", n: "Aceite vegetal 1 L", p: 3.8, c: 2.9, mon: "USD", prov: "Alimentos del Valle", quedan: 11, bg: "#F4D35E", fg: "#4a3700", t: "ACEITE", may: [3.5, 6] },
  { k: "azucar", n: "Azúcar 1 kg", p: 1.7, c: 1.25, mon: "USD", prov: "Alimentos del Valle", quedan: 9, bg: "#F3F0EA", fg: "#2f2f2f", t: "AZÚCAR", may: null },
  { k: "cafe", n: "Café molido 250 g", p: 3.2, c: 2.3, mon: "USD", prov: "Alimentos del Valle", quedan: 0, bg: "#5A3A28", fg: "#F6E9DD", t: "CAFÉ", may: null },
  { k: "pasta", n: "Pasta larga 500 g", p: 1.35, c: 0.95, mon: "USD", prov: "Distribuidora Andina", quedan: 14, bg: "#EFC57F", fg: "#4a3000", t: "PASTA", may: [1.2, 12] },
  { k: "leche", n: "Leche en polvo 400 g", p: 6.5, c: 5.1, mon: "USD", prov: "Importadora Caracas", quedan: 3, bg: "#DCE8F4", fg: "#1c3550", t: "LECHE", may: null },
  { k: "margarina", n: "Margarina 500 g", p: 2.6, c: 1.9, mon: "USD", prov: "Alimentos del Valle", quedan: 7, bg: "#F8E58B", fg: "#4a3f00", t: "MARGARINA", may: null },
  { k: "sal", n: "Sal fina 1 kg", p: 0.9, c: 0.6, mon: "USD", prov: "Distribuidora Andina", quedan: 30, bg: "#E3EDF3", fg: "#27404f", t: "SAL", may: null },
  { k: "detergente", n: "Detergente en polvo 1 kg", p: 4.8, c: 3.7, mon: "USD", prov: "Aseo Total", quedan: 4, bg: "#8CCBEA", fg: "#0c3550", t: "DETERGENTE", may: null },
  { k: "jabon", n: "Jabón de baño", p: 1.1, c: 0.7, mon: "USD", prov: "Aseo Total", quedan: 22, bg: "#F4BFCB", fg: "#5a1f2e", t: "JABÓN", may: null },
  { k: "refresco", n: "Refresco 2 L", p: 2.4, c: 1.7, mon: "USD", prov: "Importadora Caracas", quedan: 6, bg: "#E4694A", fg: "#fff3ee", t: "REFRESCO", may: null },
  { k: "oliva", n: "Aceite de oliva 500 ml", p: 7.5, c: 5.8, mon: "EUR", prov: "Importadora Caracas", quedan: 8, bg: "#A9BC78", fg: "#233012", t: "OLIVA", may: null },
  { k: "pastaIt", n: "Pasta italiana 500 g", p: 2.2, c: 1.5, mon: "EUR", prov: "Importadora Caracas", quedan: 5, bg: "#DDA86A", fg: "#3d2406", t: "PASTA IT", may: null },
];

async function ficha(t, bg, fg) {
  const tam = t.length > 8 ? 74 : t.length > 6 ? 92 : 118;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <rect width="800" height="800" fill="${bg}"/>
    <text x="400" y="440" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${tam}"
      text-anchor="middle" fill="${fg}" letter-spacing="-2">${t}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

const prod = {}; // k -> fila
const vendidas = {}; // k -> unidades vendidas, para calcular el stock de apertura
for (const p of PRODUCTOS) {
  const ruta = `${OWNER}/${crypto.randomUUID()}.jpg`;
  const { error: eUp } = await admin.storage
    .from("product-photos")
    .upload(ruta, await ficha(p.t, p.bg, p.fg), { contentType: "image/jpeg" });
  if (eUp) throw new Error(`foto ${p.k}: ${eUp.message}`);
  const { data, error } = await admin
    .from("products")
    .insert({
      owner_id: OWNER,
      name: p.n,
      base_currency: p.mon,
      base_currency_retail: p.mon,
      base_currency_wholesale: p.mon,
      price_retail: p.p,
      price_wholesale: p.may?.[0] ?? null,
      wholesale_min_quantity: p.may?.[1] ?? null,
      cost: p.c,
      cost_currency: p.mon,
      margin_retail_pct: Math.round(((p.p - p.c) / p.c) * 100),
      margin_wholesale_pct: p.may ? Math.round(((p.may[0] - p.c) / p.c) * 100) : null,
      supplier: p.prov,
      published_retail: true,
      published_wholesale: Boolean(p.may),
      photo_path: ruta,
      stock_opening: 0, // se recalcula al final, con lo que se vendió
      stock_opening_at: new Date(AHORA - 45 * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`producto ${p.k}: ${error.message}`);
  prod[p.k] = { ...p, id: data.id };
  vendidas[p.k] = 0;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. EL CATÁLOGO COMPARTIBLE
// ══════════════════════════════════════════════════════════════════════════
const catalogToken = Array.from({ length: 32 }, () => "0123456789abcdef"[entre(0, 15)]).join("");
const { data: enlace } = await admin
  .from("catalog_share_links")
  .insert({ owner_id: OWNER, token: catalogToken })
  .select("id")
  .single();

// ══════════════════════════════════════════════════════════════════════════
// 4. CLIENTES, VENTAS Y MOVIMIENTOS
// ══════════════════════════════════════════════════════════════════════════
const mostrador = (
  await admin.from("clients").insert({ owner_id: OWNER, name: "Mostrador", is_walk_in: true }).select("id").single()
).data.id;

const cliente = {}; // clave -> id
let telefono = 100;
async function nuevoCliente(k, name, extra = {}) {
  telefono += 1;
  const { data, error } = await admin
    .from("clients")
    .insert({
      owner_id: OWNER,
      name,
      whatsapp: `58414555${String(telefono).padStart(4, "0")}`,
      document_id: String(11000000 + entre(100000, 9999999)),
      document_type: "V",
      document_country: "VE",
      document_source: "owner",
      created_at: new Date(AHORA - 60 * 86400000).toISOString(),
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cliente ${name}: ${error.message}`);
  cliente[k] = data.id;
}

const lineas = (cesta) =>
  cesta.map(([k, qty]) => {
    const p = prod[k];
    vendidas[k] += qty;
    return { product_id: p.id, name: p.n, quantity: qty, unit_price: p.p, currency: p.mon, tier: "retail" };
  });
const total = (ls) => r2(ls.reduce((s, l) => s + l.quantity * l.unit_price, 0));

const sellos = (mon, bs) => ({
  rate_mode_used: "BCV_AUTO",
  exchange_rate_used: mon === "EUR" ? TASA_EUR : TASA_USD,
  official_bcv_rate_at_time: mon === "EUR" ? TASA_EUR : TASA_USD,
  rate_usd_at_time: TASA_USD,
  rate_eur_at_time: TASA_EUR,
  ...(bs != null ? { entry_currency: "VES", entry_amount: bs } : {}),
});

// Una venta FIADA: la venta, sus líneas, y el cargo que nace de ella.
const ventasCreadas = {};
async function fiado(k, dias, plazo, cesta, etiqueta = k) {
  const ls = lineas(cesta);
  const mon = ls[0].currency;
  const importe = total(ls);
  const cuando = hace(dias);
  const { data: venta } = await admin
    .from("sales")
    .insert({ owner_id: OWNER, client_id: cliente[k], created_at: cuando, created_by: OWNER })
    .select("id")
    .single();
  await admin.from("sale_lines").insert(ls.map((l) => ({ ...l, sale_id: venta.id, created_at: cuando })));
  const { error } = await admin.from("movements").insert({
    client_id: cliente[k],
    created_by: OWNER,
    type: "charge",
    amount: importe,
    currency: mon,
    plazo_dias: plazo,
    created_at: cuando,
    sale_id: venta.id,
    source: "manual",
    ...sellos(mon, null),
  });
  if (error) throw new Error(`cargo ${k}: ${error.message}`);
  (ventasCreadas[etiqueta] ??= []).push(venta.id);
  return importe;
}

async function abono(k, dias, monto, mon = "USD", enBs = true) {
  const { error } = await admin.from("movements").insert({
    client_id: cliente[k],
    created_by: OWNER,
    type: "payment",
    amount: monto,
    currency: mon,
    created_at: hace(dias, 15),
    source: "manual",
    ...(enBs
      ? sellos(mon, r2(monto * (mon === "EUR" ? TASA_EUR : TASA_USD)))
      : { ...sellos(mon, null), entry_currency: mon, entry_amount: monto }),
  });
  if (error) throw new Error(`abono ${k}: ${error.message}`);
}

// ── Los clientes. Cada uno cuenta una situación distinta ───────────────────
await nuevoCliente("julia", "Julia Ramírez"); // el buen pagador, el del puntaje alto
await nuevoCliente("pedro", "Pedro Salazar"); // crítico
await nuevoCliente("luisa", "Luisa Camacho");
await nuevoCliente("miguel", "Miguel Brito"); // debe en euros
await nuevoCliente("yolimar", "Yolimar Rojas");
await nuevoCliente("ender", "Ender Pacheco");
await nuevoCliente("carmen", "Carmen Linares"); // sin deuda
await nuevoCliente("alexis", "Alexis Montilla", { is_flagged: true }); // mala paga
await nuevoCliente("dayana", "Dayana Torres");
await nuevoCliente("rafael", "Rafael Colmenares"); // dos libros
await nuevoCliente("mariela", "Mariela Guédez"); // saldo a favor
await nuevoCliente("jhonny", "Jhonny Perozo");
await nuevoCliente("rosa", "Rosa Villegas");
await nuevoCliente("nelson", "Nelson Arteaga");

// Julia: tres fiados pagados a tiempo, uno abierto. Puntaje alto.
await fiado("julia", 70, 15, [["harina", 8], ["arroz", 6], ["aceite", 2]]);
await abono("julia", 62, 29.1);
await fiado("julia", 50, 15, [["pasta", 10], ["azucar", 5], ["margarina", 3]]);
await abono("julia", 44, 29.8);
await fiado("julia", 28, 15, [["harina", 6], ["leche", 1], ["sal", 2]]);
await abono("julia", 21, 17.9);
await fiado("julia", 4, 15, [["aceite", 3], ["arroz", 8], ["harina", 10], ["jabon", 4]]);

await fiado("pedro", 62, 30, [["aceite", 6], ["harina", 12], ["arroz", 10], ["leche", 4], ["azucar", 10], ["detergente", 4]]);
await fiado("luisa", 6, 15, [["harina", 10], ["arroz", 8], ["aceite", 4], ["pasta", 8], ["refresco", 4]]);
await fiado("miguel", 25, 15, [["oliva", 3], ["pastaIt", 6]]);
await fiado("yolimar", 38, 15, [["aceite", 8], ["harina", 14], ["arroz", 12], ["leche", 6], ["azucar", 12], ["pasta", 14]]);
await abono("yolimar", 30, 50);
await fiado("ender", 14, 15, [["aceite", 2], ["harina", 5], ["jabon", 3]]);
await fiado("carmen", 40, 15, [["harina", 5], ["arroz", 5]]);
await abono("carmen", 33, 15.25);
await fiado("carmen", 20, 7, [["pasta", 6], ["sal", 3]]);
await abono("carmen", 17, 10.8);
await fiado("alexis", 75, 30, [["aceite", 10], ["harina", 20], ["arroz", 20], ["leche", 8], ["azucar", 20], ["detergente", 8], ["refresco", 10]]);
await fiado("dayana", 3, 7, [["aceite", 5], ["harina", 10], ["arroz", 8], ["margarina", 4], ["pasta", 6]]);
await fiado("rafael", 5, 15, [["aceite", 2], ["harina", 6], ["arroz", 4]]);
await fiado("rafael", 5, 15, [["oliva", 1], ["pastaIt", 2]], "rafael-eur");
await fiado("mariela", 20, 15, [["harina", 8], ["arroz", 6], ["pasta", 4]]);
await abono("mariela", 12, 40);
await fiado("jhonny", 2, 15, [["aceite", 6], ["harina", 14], ["arroz", 12], ["azucar", 8], ["leche", 2]]);
await fiado("rosa", 1, 7, [["harina", 4], ["arroz", 3], ["jabon", 3]]);
await fiado("nelson", 20, 7, [["aceite", 7], ["harina", 14], ["arroz", 12], ["pasta", 10], ["margarina", 4], ["refresco", 6]]);

// ── Ventas de CONTADO de las dos últimas semanas, para que Reportes respire ─
const CESTAS = [
  [["harina", 2], ["arroz", 1]],
  [["aceite", 1], ["sal", 1]],
  [["refresco", 2], ["pasta", 1]],
  [["azucar", 2], ["cafe", 1]],
  [["harina", 4], ["arroz", 3], ["pasta", 2]],
  [["jabon", 2], ["detergente", 1]],
  [["leche", 1], ["margarina", 1]],
  [["oliva", 1]],
  [["harina", 1]],
  [["pasta", 3], ["aceite", 1], ["refresco", 1]],
];
let primeraContado = null;
for (let d = 13; d >= 0; d--) {
  const n = entre(2, 4);
  for (let i = 0; i < n; i++) {
    // `cafe` sigue vendiéndose HASTA que se agota; no se vende más café del que
    // hay, o el stock de apertura saldría negativo y la captura mentiría.
    const cesta = CESTAS[entre(0, CESTAS.length - 1)].filter(([k]) => k !== "cafe" || d > 8);
    if (!cesta.length) continue;
    const ls = lineas(cesta);
    const mon = ls[0].currency;
    const monto = total(ls.filter((l) => l.currency === mon));
    const cuando = hace(d, entre(8, 18));
    const { data: venta } = await admin
      .from("sales")
      .insert({
        owner_id: OWNER,
        client_id: azar() < 0.65 ? mostrador : cliente[["carmen", "julia", "mariela"][entre(0, 2)]],
        created_at: cuando,
        created_by: OWNER,
      })
      .select("id")
      .single();
    await admin.from("sale_lines").insert(ls.filter((l) => l.currency === mon).map((l) => ({ ...l, sale_id: venta.id, created_at: cuando })));
    const tasa = mon === "EUR" ? TASA_EUR : TASA_USD;
    const enBs = azar() < 0.55;
    await admin.from("sale_payments").insert({
      sale_id: venta.id,
      currency: mon,
      amount: monto,
      created_at: cuando,
      ...(enBs ? { entry_currency: "VES", entry_amount: r2(monto * tasa), rate_used: tasa } : {}),
    });
    primeraContado ??= venta.id;
    (ventasCreadas.contado ??= []).push(venta.id);
  }
}

// ── LA CANTIDAD ACTUAL, escrita al final y sin sumar nada ───────────────────
//
// La migración `163` (2026-10-27) hace que cada línea de venta DESCUENTE
// `products.stock_opening`, que desde entonces es la cantidad de hoy y no el
// asiento de apertura. Las ventas de arriba se insertaron con el producto a 0,
// así que no tomaron nada; lo que queda por hacer es escribir la cantidad que
// se quiere enseñar. La primera versión de este script sumaba además lo
// vendido ("apertura = lo que queda + lo vendido"), que era cierto ANTES de la
// 163 y contaba dos veces después: la Leche, que debía quedar en 3 y salir
// ámbar, salía con 60.
for (const p of PRODUCTOS) {
  await admin.from("products").update({ stock_opening: p.quedan }).eq("id", prod[p.k].id);
}

// ── Una marca de mala paga con su historia ───────────────────────────────────
await admin.from("client_flags").insert({
  client_id: cliente.alexis,
  owner_id: OWNER,
  reason: "Dejó de contestar",
  flagged_at: hace(8),
});

// ── Los saldos, recalculados: varias filas comparten instante ────────────────
for (const id of Object.values(cliente)) {
  await admin.rpc("recalc_client_running_balance", { p_client_id: id });
}

// ══════════════════════════════════════════════════════════════════════════
// 5. PEDIDOS DEL CATÁLOGO — los dos sin registrar. Con uno «visto» y otro «nuevo» la
//    pantalla de Pedidos decía «1 sin registrar» sobre una lista de dos con la misma etiqueta.
// ══════════════════════════════════════════════════════════════════════════
const PEDIDOS = [
  { n: "Karina Medina", dias: 0, items: [["harina", 4], ["arroz", 3], ["aceite", 1]] },
  { n: "Gustavo Rondón", dias: 2, items: [["pasta", 6], ["refresco", 2]] },
];
for (const o of PEDIDOS) {
  const { data: ped } = await admin
    .from("catalog_orders")
    .insert({
      owner_id: OWNER,
      catalog_link_id: enlace.id,
      customer_name: o.n,
      customer_document: String(14000000 + entre(100000, 999999)),
      customer_document_type: "V",
      customer_whatsapp: `58424555${String(entre(1000, 9999))}`,
      customer_whatsapp_raw: "04245550000",
      wants_whatsapp_notices: true,
      status: o.visto ? "seen" : "new",
      seen_at: o.visto ? hace(o.dias) : null,
      created_at: hace(o.dias, 9),
    })
    .select("id")
    .single();
  await admin.from("catalog_order_items").insert(
    o.items.map(([k, q]) => ({
      order_id: ped.id,
      product_id: prod[k].id,
      product_name: prod[k].n,
      quantity: q,
      unit_price: prod[k].p,
      currency: prod[k].mon,
      tier: "retail",
    })),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6. EL ENLACE DE SALDO DE JULIA, que es lo que ve un cliente
// ══════════════════════════════════════════════════════════════════════════
const shareToken = Array.from({ length: 32 }, () => "0123456789abcdef"[entre(0, 15)]).join("");
await admin.from("share_links").insert({ client_id: cliente.julia, token: shareToken });

const manifiesto = {
  email: EMAIL,
  ownerId: OWNER,
  catalogToken,
  shareToken,
  clientes: cliente,
  productos: Object.fromEntries(Object.entries(prod).map(([k, v]) => [k, v.id])),
  ventas: { contadoEjemplo: primeraContado, fiadoJulia: ventasCreadas.julia?.at(-1), fiadoPedro: ventasCreadas.pedro?.[0] },
  tasa: { usd: TASA_USD, eur: TASA_EUR },
};
writeFileSync(`${ROOT}/dashboard/scripts/ayuda/demo-manifest.json`, JSON.stringify(manifiesto, null, 2));

// ── Y UN CONTEO, para que se vea qué quedó ───────────────────────────────────
const cuenta = async (t, col = "owner_id") =>
  (await admin.from(t).select("id", { count: "exact", head: true }).eq(col, OWNER)).count;
console.log(`✔ ${NEGOCIO} listo`);
console.log(`  clientes ${await cuenta("clients")} · productos ${await cuenta("products")} · ventas ${await cuenta("sales")} · pedidos ${await cuenta("catalog_orders")}`);
